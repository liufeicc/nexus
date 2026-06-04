/**
 * MIME 类型映射工具
 *
 * 根据文件扩展名返回对应的 MIME 类型。
 */

const MIME_MAP: Record<string, string> = {
  // 图片
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  // 文档
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // 文本/代码
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'application/javascript',
  '.py': 'text/x-python',
  '.html': 'text/html',
  '.css': 'text/css',
}

const FALLBACK = 'application/octet-stream'

/**
 * 根据文件扩展名获取 MIME 类型
 *
 * @param ext 文件扩展名（如 '.png'）
 * @returns MIME 类型字符串，未知扩展名返回 'application/octet-stream'
 */
export function getMimeType(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? FALLBACK
}
