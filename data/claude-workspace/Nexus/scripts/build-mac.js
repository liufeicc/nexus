/**
 * macOS 打包包装脚本
 *
 * 解决问题：macOS 新版系统对 /private/var/folders 临时目录有安全限制，
 * 导致 electron-builder 创建 DMG 时 hdiutil resize 报 "资源暂时不可用" (code 35)。
 *
 * 解法：把临时目录改到项目本地的 .tmp-build，绕过系统限制。
 * 仅影响 macOS 打包流程，Windows/Linux 不使用此脚本。
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const tmpDir = path.join(rootDir, '.tmp-build');

// 创建本地临时目录
fs.mkdirSync(tmpDir, { recursive: true });

// 获取额外的 electron-builder 参数（如 --mac, --win 等）
const extraArgs = process.argv.slice(2).join(' ');

console.log(`[build-mac] 使用本地临时目录: ${tmpDir}`);

try {
  execSync(`npx electron-builder ${extraArgs}`.trim(), {
    stdio: 'inherit',
    cwd: rootDir,
    env: {
      ...process.env,
      TMPDIR: tmpDir,
    },
  });
} catch (e) {
  console.error('[build-mac] 打包失败:', e.message);
  process.exit(1);
} finally {
  // 打包完成后清理临时目录
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
}
