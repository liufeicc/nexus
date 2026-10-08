# ============================================================
# t-win.ps1 —— nexus-win-panel.exe 独立联调脚本（Windows 实机运行）
#
# 对应 Linux 侧 t4.sh 的定位：脱离 Electron，用 PowerShell 直接驱动
# 行协议，验证 daemon 90% 的逻辑（容器/过继/找窗/杀进程/枚举）。
#
# 用法（在 VM 内，共享文件夹中的 win-panel 目录下）:
#   powershell -ExecutionPolicy Bypass -File t-win.ps1
#   powershell -ExecutionPolicy Bypass -File t-win.ps1 -Target calc.exe
#
# 测试流程：
#   1. 起一个 WinForms 宿主窗体模拟 Electron 主窗口，取其 HWND；
#   2. ping/version/caps 握手；
#   3. create-container 创建容器 → 启动目标程序 → find-window 循环找主窗口
#      → attach-app 过继 → map 显示（此时应看到程序嵌入测试窗口、标题栏消失）；
#   4. set-bounds 移动/缩放容器（应看到程序跟随变化）；
#   5. list-apps 枚举计数；
#   6. kill-app 两段式杀进程 → 断言进程无残留 → destroy 容器 → quit。
# ============================================================

param(
    [string]$Exe = (Join-Path $PSScriptRoot 'nexus-win-panel.exe'),
    [string]$Target = 'notepad.exe'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Exe)) {
    Write-Host "错误: 找不到 $Exe（先在 Linux 开发机运行 build.sh 交叉编译）" -ForegroundColor Red
    exit 1
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ---------- 宿主窗体（模拟 Electron 主窗口） ----------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Nexus win-panel 联调宿主'
$form.Size = New-Object System.Drawing.Size(1100, 760)
$form.StartPosition = 'CenterScreen'
$form.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 40)
$form.Show()
$form.Activate()
[System.Windows.Forms.Application]::DoEvents()
$hostHwnd = $form.Handle.ToInt64()
$hostCssW = 1100   # 与 CreateWindow 尺寸一致（DPI 换算的"尺子"）
$hostCssH = 760
Write-Host "宿主窗口 HWND=$hostHwnd" -ForegroundColor Cyan

# ---------- 启动 daemon ----------
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $Exe
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)

# 后台持续读 stderr 透传显示
$stderrJob = Start-Job -ScriptBlock {
    param($p)
    while (-not $p.StandardError.EndOfStream) { $p.StandardError.ReadLine() }
} -ArgumentList $proc 2>$null

$script:step = 0
$script:failed = $false

function Send-Cmd([string]$cmd, [bool]$expectOk = $true) {
    $script:step++
    $proc.StandardInput.WriteLine($cmd)
    $proc.StandardInput.Flush()
    $resp = $proc.StandardOutput.ReadLine()
    $short = if ($resp.Length -gt 100) { $resp.Substring(0, 100) + '…' } else { $resp }
    $ok = $resp -like 'ok*'
    $mark = if ($ok) { '✓' } else { '✗' }
    Write-Host ("[{0}] {1} {2,-46} => {3}" -f $script:step, $mark, $cmd, $short) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
    if ($expectOk -and -not $ok) { $script:failed = $true }
    return $resp
}

function Get-Arg([string]$resp, [int]$idx) {
    return ($resp -split '\s+')[$idx]
}

try {
    # ---------- 1. 握手 ----------
    Send-Cmd 'ping' | Out-Null
    $ver = Send-Cmd 'version'
    Write-Host "    daemon 版本: $(Get-Arg $ver 1)" -ForegroundColor Cyan
    Send-Cmd 'caps' | Out-Null

    # ---------- 2. 容器 + 启动目标程序 ----------
    $resp = Send-Cmd "create-container $hostHwnd 40 40 700 480 $hostCssW $hostCssH"
    $container = Get-Arg $resp 1
    Write-Host "    容器 HWND=$container" -ForegroundColor Cyan

    Write-Host "启动目标程序: $Target" -ForegroundColor Cyan
    $app = Start-Process $Target -PassThru
    Write-Host "    pid=$($app.Id)"

    # ---------- 3. 找窗（进程树遍历，最多 15s） ----------
    $hwnd = '0'
    $deadline = (Get-Date).AddSeconds(15)
    while ($hwnd -eq '0' -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 300
        $resp = Send-Cmd "find-window $($app.Id) 200 150"
        $hwnd = Get-Arg $resp 1
    }
    if ($hwnd -eq '0') { throw "15s 内未找到主窗口" }
    Write-Host "    找到主窗口 HWND=$hwnd" -ForegroundColor Cyan

    # ---------- 4. 过继 + 显示 ----------
    Send-Cmd "attach-app $container $hwnd" | Out-Null
    Send-Cmd "map $container" | Out-Null
    Send-Cmd "raise $container" | Out-Null
    Write-Host "→ 请确认：程序已嵌入深色窗口内、标题栏消失、可输入操作" -ForegroundColor Yellow
    Start-Sleep -Seconds 3

    # ---------- 5. set-bounds 移动/缩放（程序应跟随重排） ----------
    Send-Cmd "set-bounds $container 120 80 800 560 $hostCssW $hostCssH" | Out-Null
    Write-Host "→ 请确认：容器移动并放大，内部程序跟随重排" -ForegroundColor Yellow
    Start-Sleep -Seconds 2

    # ---------- 6. 枚举 ----------
    $resp = Send-Cmd 'list-apps'
    $b64 = Get-Arg $resp 1
    $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
    $apps = ($json | ConvertFrom-Json).apps
    Write-Host "    开始菜单枚举到 $($apps.Count) 个应用，示例: $($apps[0].name)" -ForegroundColor Cyan

    # ---------- 7. kill 与清理 ----------
    Send-Cmd "kill-app $hwnd $($app.Id)" | Out-Null
    Start-Sleep -Milliseconds 500
    $alive = $false
    try { $alive = -not (Get-Process -Id $app.Id -ErrorAction Stop).HasExited } catch { $alive = $false }
    if ($alive) {
        Write-Host "✗ 进程残留: pid=$($app.Id)" -ForegroundColor Red
        $script:failed = $true
    } else {
        Write-Host "✓ 进程无残留" -ForegroundColor Green
    }
    Send-Cmd "destroy $container" | Out-Null
    Send-Cmd 'quit' | Out-Null
}
catch {
    Write-Host "异常: $_" -ForegroundColor Red
    $script:failed = $true
}
finally {
    try { $proc.Kill() } catch { }
    $form.Close()
}

if ($script:failed) {
    Write-Host '联调结果: 有失败项 ✗' -ForegroundColor Red
    exit 1
} else {
    Write-Host '联调结果: 全部通过 ✓' -ForegroundColor Green
    exit 0
}
