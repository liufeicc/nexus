/**
 * 编译前环境准备脚本
 *
 * 功能：
 * 1. 删除当前的 node_modules 目录
 * 2. 重新安装依赖（确保原生模块与当前平台匹配）
 *
 * 使用方式：
 *   npm run setup
 *
 * 作者：liufei
 * 日期：2026-06-18
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const platform = process.platform;
const rootDir = path.join(__dirname, '..');
const currentNodeModules = path.join(rootDir, 'node_modules');

console.log('========================================');
console.log('Nexus 编译环境准备');
console.log('========================================');
console.log(`当前平台：${platform}`);
console.log('========================================\n');

/**
 * 删除目录（递归，兼容 Windows）
 */
function removeDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.log('node_modules 不存在，跳过删除');
    return;
  }

  console.log('正在删除 node_modules...');

  // 优先使用 Node.js 内置方法
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log('删除成功');
    return;
  } catch (e) {
    console.log(`Node.js 删除失败 (${e.code})，尝试系统命令...`);
  }

  // Windows 使用 rmdir，Linux/macOS 使用 rm
  try {
    if (platform === 'win32') {
      execSync(`cmd /c rmdir /s /q "${dirPath}"`, { stdio: 'pipe' });
    } else {
      execSync(`rm -rf "${dirPath}"`, { stdio: 'pipe' });
    }
    console.log('系统命令删除成功');
  } catch (e) {
    console.error('删除失败，请手动删除 node_modules 目录');
    console.error(`路径：${dirPath}`);
    console.error(`错误：${e.message}`);
    process.exit(1);
  }
}

// 主流程
try {
  // 步骤 1：删除 node_modules
  console.log('[1/2] 清理旧依赖...');
  removeDir(currentNodeModules);

  // 步骤 2：重新安装
  console.log('\n[2/2] 安装依赖...');
  console.log('这可能需要几分钟，请耐心等待...\n');

  try {
    execSync('npm install', {
      stdio: 'inherit',
      cwd: rootDir
    });
    console.log('\n依赖安装完成');
  } catch (e) {
    console.error('\nnpm install 失败:', e.message);
    console.error('请检查网络连接或手动运行 npm install');
    process.exit(1);
  }

  // 步骤 3：修复原生模块执行权限（node-pty spawn-helper 等）
  console.log('\n[3/3] 修复原生模块权限...');
  try {
    if (platform !== 'win32') {
      const prebuildsDir = path.join(currentNodeModules, 'node-pty', 'prebuilds');
      if (fs.existsSync(prebuildsDir)) {
        // 递归查找所有 spawn-helper 文件并赋予执行权限
        function fixPermissions(dir) {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              fixPermissions(fullPath);
            } else if (entry.name === 'spawn-helper') {
              fs.chmodSync(fullPath, 0o755);
              console.log(`  已修复: ${path.relative(rootDir, fullPath)}`);
            }
          }
        }
        fixPermissions(prebuildsDir);
      }
    }
    console.log('权限修复完成');
  } catch (e) {
    console.log('权限修复跳过:', e.message);
  }

  console.log('\n========================================');
  console.log('环境准备完成！');
  console.log('========================================');
  console.log('现在可以运行编译命令');
  console.log('========================================\n');

} catch (e) {
  console.error('\n准备过程中发生错误:', e.message);
  console.error(e.stack);
  process.exit(1);
}
