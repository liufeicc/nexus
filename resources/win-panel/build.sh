#!/usr/bin/env bash
# ============================================================
# Nexus Windows 应用面板 helper（nexus-win-panel.exe）交叉编译脚本
#
# 依赖（Linux 开发机）: sudo apt install g++-mingw-w64-x86-64
# 备选（Windows 实机）: MSYS2 安装 mingw-w64-x86_64-gcc 后
#        将下方 CC 改为 mingw32-g++ 执行本脚本
#
# ⚠️ 铁律：C++ 源码任何改动必须重跑本脚本，并把新 exe 与源码
#    一起提交；同时递增 NEXUS_WIN_PANEL_VERSION（并保持与
#    win-bridge.service.ts 的 EXPECTED_HELPER_VERSION 一致），
#    否则 TS 侧版本校验会拒绝启动 daemon。
#
# -mwindows：GUI 子系统（不弹控制台窗口）；stdin/stdout 管道
#   在 GUI 子系统下依然可用（Node 以管道方式 spawn）。
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

CC=x86_64-w64-mingw32-g++
if ! command -v "$CC" >/dev/null 2>&1; then
  echo "错误: 未找到 $CC" >&2
  echo "  Linux 开发机请先安装: sudo apt install g++-mingw-w64-x86-64" >&2
  echo "  或在 Windows 机器上用 MSYS2: pacman -S mingw-w64-x86_64-gcc，并把 CC 改为 mingw32-g++" >&2
  exit 1
fi

# P2 阶段 scale 模块加入后，SRCS 追加 nexus_win_panel_scale.cpp
SRCS="nexus_win_panel.cpp nexus_win_panel_apps.cpp"
OUT="nexus-win-panel.exe"

"$CC" -O2 -Wall -Wextra -static-libgcc -static-libstdc++ \
  -o "$OUT" $SRCS \
  -luser32 -lgdi32 -ldwmapi -lole32 -loleaut32 -lshell32 -luuid \
  -lgdiplus -lshlwapi -ladvapi32 -lcomctl32 \
  -mwindows

echo "编译完成: $(pwd)/$OUT"
ls -lh "$OUT"
