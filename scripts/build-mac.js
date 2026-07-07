#!/usr/bin/env node
/**
 * macOS 构建脚本
 * 处理 macOS 上临时目录安全限制导致的 electron-builder 问题
 *
 * 问题：macOS 的 /tmp 目录有安全限制，可能导致签名失败
 * 解决：使用自定义临时目录并设置正确的权限
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 只在 macOS 上执行特殊处理
if (process.platform === 'darwin') {
  console.log('🍎 macOS 构建环境检测');

  // 创建安全的临时目录
  const safeTmpDir = path.join(os.homedir(), '.nexus-build-tmp');

  try {
    if (!fs.existsSync(safeTmpDir)) {
      fs.mkdirSync(safeTmpDir, { recursive: true });
      console.log(`✓ 创建临时目录: ${safeTmpDir}`);
    }

    // 设置正确的权限（仅所有者可读写执行）
    fs.chmodSync(safeTmpDir, 0o700);
    console.log('✓ 设置临时目录权限');

    // 设置环境变量
    process.env.TMPDIR = safeTmpDir;
    process.env.TEMP = safeTmpDir;
    process.env.TMP = safeTmpDir;

    console.log('✓ 临时目录环境变量已设置');
  } catch (error) {
    console.warn('⚠️  设置临时目录失败，继续使用系统默认:', error.message);
  }
}

// 执行 electron-builder
console.log('\n📦 开始构建...\n');

try {
  execSync('electron-builder --mac', {
    stdio: 'inherit',
    env: process.env
  });
  console.log('\n✅ 构建成功完成！');
} catch (error) {
  console.error('\n❌ 构建失败:', error.message);
  process.exit(1);
}
