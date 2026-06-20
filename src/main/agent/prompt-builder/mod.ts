// Barrel export — 从实际实现模块导入，避免从 './index' 自引用循环
export { buildSystemPrompt, buildNexusProfileBlock } from './index'
export type { BuildSystemPromptOptions, PromptLanguage } from './types'
