/**
 * 测试脚本：测试 writeFile 工具的新功能
 * 运行方式：node scripts/test-writefile.mjs
 *
 * 测试内容：
 * 1. 写入黑名单检查
 * 2. 敏感系统路径检查
 * 3. Staleness 检测
 * 4. 预期拒绝错误分类
 */

import fs from 'fs'
import path from 'path'

const TEST_DIR = '/tmp/tview-write-test'

function setup() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true })
  fs.mkdirSync(TEST_DIR, { recursive: true })
}

function cleanup() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true })
}

// 内联 write 保护逻辑（Node strip-only 不支持跨模块 TS 导入）

const WRITE_DENIED_PATHS = new Set([
  '/etc/sudoers',
  '/etc/passwd',
  '/etc/shadow',
])

const WRITE_DENIED_PREFIXES = [
  '/etc/sudoers.d/',
  '/etc/systemd/',
  '/boot/',
  '/usr/lib/systemd/',
]

const SENSITIVE_PATH_PREFIXES = [
  '/etc/',
  '/boot/',
  '/usr/lib/systemd/',
  '/private/etc/',
  '/private/var/',
]

const SENSITIVE_EXACT_PATHS = [
  '/var/run/docker.sock',
  '/run/docker.sock',
]

function isWriteDenied(filePath) {
  const resolved = path.resolve(filePath)
  if (WRITE_DENIED_PATHS.has(resolved)) return { denied: true, reason: `'${filePath}' 是受保护的系统/凭证文件` }
  for (const prefix of WRITE_DENIED_PREFIXES) {
    if (resolved.startsWith(prefix)) return { denied: true, reason: `'${filePath}' 位于受保护的目录 ${prefix} 下` }
  }
  return { denied: false }
}

function checkSensitivePath(filePath) {
  const resolved = path.resolve(filePath)
  const normalized = path.normalize(filePath)
  for (const p of SENSITIVE_PATH_PREFIXES) {
    if (resolved.startsWith(p) || normalized.startsWith(p)) {
      return `拒绝写入敏感系统路径: ${filePath}\n如需修改系统文件，请使用 terminal 工具 + sudo`
    }
  }
  for (const p of SENSITIVE_EXACT_PATHS) {
    if (resolved === p || normalized === p) {
      return `拒绝写入敏感系统路径: ${filePath}\n如需修改系统文件，请使用 terminal 工具 + sudo`
    }
  }
  return null
}

function isExpectedWriteError(err) {
  const code = err?.code
  return code === 'EACCES' || code === 'EPERM' || code === 'EROFS'
}

// Staleness tracking
const readTimestamps = new Map()

function updateReadTimestamp(filePath) {
  try {
    const resolved = path.resolve(filePath)
    const mtime = fs.statSync(resolved).mtimeMs
    readTimestamps.set(resolved, mtime)
  } catch {}
}

function checkFileStaleness(filePath) {
  try {
    const resolved = path.resolve(filePath)
    const readMtime = readTimestamps.get(resolved)
    if (readMtime == null) return null
    const currentMtime = fs.statSync(resolved).mtimeMs
    if (currentMtime !== readMtime) {
      return `警告: ${filePath} 在你上次读取后被修改。你读取的内容可能已过时，建议在写入前重新读取文件确认当前内容。`
    }
  } catch {}
  return null
}

// ==================== 测试用例 ====================

function testWriteDenyExact() {
  console.log('=== 测试 1: 写入黑名单（精确路径）===')
  console.log('  /etc/passwd:', isWriteDenied('/etc/passwd').denied)
  console.log('  /etc/shadow:', isWriteDenied('/etc/shadow').denied)
  console.log('  /etc/sudoers:', isWriteDenied('/etc/sudoers').denied)
  const ok = isWriteDenied('/tmp/test.txt')
  console.log('  /tmp/test.txt:', ok.denied)
  console.log('  成功:', isWriteDenied('/etc/passwd').denied && isWriteDenied('/tmp/test.txt').denied === false ? 'PASS' : 'FAIL')
}

function testWriteDenyPrefix() {
  console.log('\n=== 测试 2: 写入黑名单（路径前缀）===')
  console.log('  /etc/systemd/unit.service:', isWriteDenied('/etc/systemd/unit.service').denied)
  console.log('  /boot/vmlinuz:', isWriteDenied('/boot/vmlinuz').denied)
  console.log('  /usr/lib/systemd/test:', isWriteDenied('/usr/lib/systemd/test').denied)
  console.log('  /etc/sudoers.d/custom:', isWriteDenied('/etc/sudoers.d/custom').denied)
  const p1 = isWriteDenied('/etc/systemd/unit.service')
  const p2 = isWriteDenied('/boot/vmlinuz')
  const p3 = isWriteDenied('/etc/sudoers.d/custom')
  console.log('  成功:', p1.denied && p2.denied && p3.denied ? 'PASS' : 'FAIL')
}

function testSensitivePath() {
  console.log('\n=== 测试 3: 敏感系统路径检查 ===')
  const s1 = checkSensitivePath('/etc/nginx.conf')
  const s2 = checkSensitivePath('/boot/grub.cfg')
  const s3 = checkSensitivePath('/var/run/docker.sock')
  const s4 = checkSensitivePath('/tmp/safe.txt')
  console.log('  /etc/nginx.conf:', s1 ? '拒绝' : '允许')
  console.log('  /boot/grub.cfg:', s2 ? '拒绝' : '允许')
  console.log('  docker.sock:', s3 ? '拒绝' : '允许')
  console.log('  /tmp/safe.txt:', s4 ? '拒绝' : '允许')
  console.log('  成功:', s1 && s2 && s3 && !s4 ? 'PASS' : 'FAIL')
}

function testExpectedWriteError() {
  console.log('\n=== 测试 4: 预期拒绝错误分类 ===')
  console.log('  EACCES:', isExpectedWriteError({ code: 'EACCES' }))
  console.log('  EPERM:', isExpectedWriteError({ code: 'EPERM' }))
  console.log('  EROFS:', isExpectedWriteError({ code: 'EROFS' }))
  console.log('  ENOENT:', isExpectedWriteError({ code: 'ENOENT' }))
  console.log('  成功:', isExpectedWriteError({ code: 'EACCES' }) && !isExpectedWriteError({ code: 'ENOENT' }) ? 'PASS' : 'FAIL')
}

function testStalenessFresh() {
  console.log('\n=== 测试 5: Staleness 检测（文件未变）===')
  setup()
  const file = `${TEST_DIR}/test.txt`
  fs.writeFileSync(file, 'hello', 'utf-8')
  updateReadTimestamp(file)
  const stale = checkFileStaleness(file)
  console.log('  Staleness:', stale)
  console.log('  成功:', stale === null ? 'PASS' : 'FAIL')
  cleanup()
}

function testStalenessModified() {
  console.log('\n=== 测试 6: Staleness 检测（文件被外部修改）===')
  setup()
  readTimestamps.clear()
  const file = `${TEST_DIR}/test-modified.txt`
  fs.writeFileSync(file, 'original', 'utf-8')
  updateReadTimestamp(file)
  // 外部修改（模拟其他进程编辑）
  fs.writeFileSync(file, 'modified by external process', 'utf-8')
  const stale = checkFileStaleness(file)
  console.log('  Staleness:', stale?.slice(0, 40) + '...')
  const pass = stale && stale.includes('修改')
  console.log('  成功:', pass ? 'PASS' : 'FAIL')
  cleanup()
}

function testStalenessNeverRead() {
  console.log('\n=== 测试 7: Staleness 检测（从未读取过）===')
  setup()
  readTimestamps.clear()
  const file = `${TEST_DIR}/test-neverread.txt`
  fs.writeFileSync(file, 'content', 'utf-8')
  // 不记录时间戳
  const stale = checkFileStaleness(file)
  console.log('  Staleness:', stale)
  console.log('  成功:', stale === null ? 'PASS' : 'FAIL')
  cleanup()
}

function testStalenessAfterWrite() {
  console.log('\n=== 测试 8: Staleness 检测（写入后刷新时间戳，不报 staleness）===')
  setup()
  readTimestamps.clear()
  const file = `${TEST_DIR}/test-write.txt`
  fs.writeFileSync(file, 'v1', 'utf-8')
  updateReadTimestamp(file)
  // 模拟连续写入
  fs.writeFileSync(file, 'v2', 'utf-8')
  updateReadTimestamp(file)
  fs.writeFileSync(file, 'v3', 'utf-8')
  updateReadTimestamp(file) // 刷新时间戳
  const stale = checkFileStaleness(file)
  console.log('  Staleness:', stale)
  console.log('  成功:', stale === null ? 'PASS' : 'FAIL')
  cleanup()
}

// ==================== 主测试 ====================

console.log('\n========== WriteFile 工具测试 ==========\n')

testWriteDenyExact()
testWriteDenyPrefix()
testSensitivePath()
testExpectedWriteError()
testStalenessFresh()
testStalenessModified()
testStalenessNeverRead()
testStalenessAfterWrite()

console.log('\n========== 所有测试完成 ==========\n')
