/** 主进程 / 预加载 / 渲染进程 三方共用的类型契约 */

export type ItemKind = 'text' | 'image' | 'files'

/** 自动识别出的文本子类型，用于着色和快速筛选 */
export type AutoKind = 'plain' | 'url' | 'code' | 'color' | 'path' | 'email' | 'number'

export interface ClipItem {
  id: number
  kind: ItemKind
  /** 完整文本；image 类型为 null */
  text: string | null
  /** 列表用摘要（首行、已折叠空白） */
  preview: string
  /** 内容 sha256，去重用 */
  hash: string
  /** 图片缩略图，data URL */
  thumb: string | null
  width: number | null
  height: number | null
  bytes: number
  sourceApp: string | null
  autoKind: AutoKind
  tags: string[]
  pinned: boolean
  useCount: number
  createdAt: number
  lastUsedAt: number
}

export interface ListQuery {
  /** 搜索关键词，空串表示不过滤 */
  q?: string
  /** 只看某个 kind */
  kind?: ItemKind | null
  /** 必须包含的标签 */
  tag?: string | null
  /** 只看置顶 */
  pinnedOnly?: boolean
  limit?: number
  offset?: number
}

export interface ListResult {
  items: ClipItem[]
  total: number
}

export interface Stats {
  total: number
  pinned: number
  images: number
  bytes: number
}

export interface Settings {
  /** 面板全局热键 */
  hotkey: string
  /** 最多保留条数，0 = 不限 */
  maxItems: number
  /** 最多保留天数，0 = 不限 */
  maxDays: number
  /** 跳过带「不要记录」标记的剪贴板，以及来自 sensitiveApps 的复制 */
  skipSensitive: boolean
  /** 敏感来源进程名片段，命中即不入库 */
  sensitiveApps: string[]
  /** 粘贴后自动隐藏面板 */
  hideAfterPaste: boolean
  /** 开机自启（静默启动到托盘） */
  autoLaunch: boolean
  theme: 'system' | 'light' | 'dark'
}

/** 自动粘贴的结果；失败时界面提示「已复制，请手动 Ctrl+V」 */
export interface PasteOutcome {
  ok: boolean
  reason?: 'no-native' | 'no-target' | 'focus-failed' | 'send-failed' | 'not-found'
}

export interface SecurityInfo {
  /** 主密钥是否由操作系统保护（Windows DPAPI） */
  osProtected: boolean
  /** 数据库是否加密 */
  dbEncrypted: boolean
  /** 原生能力（剪贴板序列号、自动粘贴）是否可用 */
  nativeAvailable: boolean
  /** 是否降级到内存存储（重启会丢） */
  memoryFallback: boolean
  dataDir: string
}

/** contextBridge 暴露给渲染进程的全部能力 */
export interface ZtbApi {
  list(query: ListQuery): Promise<ListResult>
  stats(): Promise<Stats>
  tags(): Promise<string[]>
  setTags(id: number, tags: string[]): Promise<void>
  togglePin(id: number): Promise<void>
  remove(id: number): Promise<void>
  clearAll(): Promise<void>
  /** 写入系统剪贴板，不改变焦点 */
  copy(id: number): Promise<void>
  /** 写入剪贴板 → 还原前台窗口 → 模拟 Ctrl+V */
  paste(id: number): Promise<PasteOutcome>
  /** 取全尺寸原图（data URL），非图片条目返回 null */
  imageDataUrl(id: number): Promise<string | null>
  hidePanel(): Promise<void>
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  security(): Promise<SecurityInfo>
  /** 在资源管理器里打开数据目录 */
  openDataDir(): Promise<void>
  /** 库有变化时触发，返回取消订阅函数 */
  onChanged(cb: () => void): () => void
  /** 面板显示时触发（用于重置选中项 / 聚焦搜索框） */
  onPanelShown(cb: () => void): () => void
}
