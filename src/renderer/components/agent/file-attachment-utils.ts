/**
 * 文件附件工具函数
 *
 * 用于文件类型判断、路径检测、内容读取等附件相关操作。
 */

// 图片文件扩展名
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.ico',
])

// 文本文件扩展名（内容 < 100KB 时直接注入）
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.log', '.json', '.csv', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.ts', '.tsx', '.js', '.jsx', '.py', '.css', '.html', '.htm', '.sh', '.bash', '.zsh',
  '.bat', '.cmd', '.ps1', '.sql', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
  '.rb', '.php', '.swift', '.kt', '.scala', '.lua', '.r', '.R', '.m', '.mdx',
  '.env', '.gitignore', '.dockerignore', '.dockerfile', 'dockerfile',
  '.vue', '.svelte', '.astro', '.md', '.markdown', '.tex', '.latex',
  '.conf', '.config', '.rc', '.properties', '.toml', '.ini', '.cfg', '.yml', '.yaml',
])

/**
 * 判断文件扩展名是否为图片
 */
export function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase())
}

/**
 * 判断文件扩展名是否为文本文件
 */
export function isTextExtension(ext: string): boolean {
  return TEXT_EXTENSIONS.has(ext.toLowerCase())
}

/**
 * 检测文件类型
 */
export function detectFileType(filePath: string): 'image' | 'text' | 'other' {
  const ext = getExtension(filePath)
  if (isImageExtension(ext)) return 'image'
  if (isTextExtension(ext)) return 'text'
  return 'other'
}

/**
 * 获取文件扩展名（含点号）
 */
function getExtension(filePath: string): string {
  const parts = filePath.split('.')
  return parts.length > 1 ? '.' + parts[parts.length - 1] : ''
}

/**
 * 获取文件名
 */
export function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

/**
 * 格式化文件大小为人类可读
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 检测输入文本是否以有效文件路径开头
 *
 * 返回解析后的路径和剩余文本，如果不是有效路径则返回 null。
 */
export function detectFilePath(input: string): { path: string; remainder: string } | null {
  const stripped = input.trim()
  if (!stripped) return null

  // 检查是否像文件路径
  const startsLikePath =
    stripped.startsWith('/') ||
    stripped.startsWith('~') ||
    stripped.startsWith('./') ||
    stripped.startsWith('../') ||
    stripped.startsWith('"') ||
    stripped.startsWith("'")

  if (!startsLikePath) return null

  // 提取第一个 token（以空格分隔）
  const spaceIdx = stripped.indexOf(' ')
  let pathToken: string
  let remainder: string

  if (spaceIdx === -1) {
    pathToken = stripped.replace(/^["']|["']$/g, '')
    remainder = ''
  } else {
    pathToken = stripped.slice(0, spaceIdx).replace(/^["']|["']$/g, '')
    remainder = stripped.slice(spaceIdx + 1).trim()
  }

  return { path: pathToken, remainder }
}

/**
 * 构建附件消息前缀
 *
 * 根据附件类型生成不同的消息格式。
 */
export function buildAttachmentPrefix(files: Array<{ name: string; type: string; path: string; content?: string }>): string {
  const parts: string[] = []

  for (const file of files) {
    switch (file.type) {
      case 'image':
        parts.push(`[User attached image: ${file.name}]`)
        break
      case 'text':
        if (file.content) {
          parts.push(`[Content of ${file.name}]:\n${file.content}`)
        } else {
          parts.push(`[User attached text file: ${file.name} (path: ${file.path})]`)
        }
        break
      case 'other':
        parts.push(`[User attached file: ${file.name} (saved at: ${file.path}). Ask the user what they'd like you to do with it.]`)
        break
    }
  }

  return parts.join('\n\n')
}
