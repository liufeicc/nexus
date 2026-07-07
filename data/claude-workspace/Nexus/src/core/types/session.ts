/**
 * 会话类型定义
 */

/**
 * 会话对象
 */
export interface Session {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  isActive: boolean
  lastUsedAt?: number
}

/**
 * 会话创建参数
 */
export interface CreateSessionParams {
  name?: string
}

/**
 * 会话更新参数
 */
export interface UpdateSessionParams {
  name?: string
  isActive?: boolean
}
