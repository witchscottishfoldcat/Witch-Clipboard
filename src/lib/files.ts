import type { ClipItem } from '@shared/types'

export interface FileInfo {
  paths: string[]
  /** 第一个文件的名字 */
  name: string
  /** 扩展名，小写不带点 */
  ext: string
  /** 所在目录（第一个文件） */
  dir: string
  kind: 'video' | 'audio' | 'image' | 'archive' | 'doc' | 'code' | 'other'
}

const VIDEO = ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm', 'm4v', 'ts', 'rmvb']
const AUDIO = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma']
const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'psd']
const ARCHIVE = ['zip', 'rar', '7z', 'tar', 'gz', 'iso']
const DOC = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv']
const CODE = ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'cs', 'json', 'sql']

function classifyExt(ext: string): FileInfo['kind'] {
  if (VIDEO.includes(ext)) return 'video'
  if (AUDIO.includes(ext)) return 'audio'
  if (IMAGE.includes(ext)) return 'image'
  if (ARCHIVE.includes(ext)) return 'archive'
  if (DOC.includes(ext)) return 'doc'
  if (CODE.includes(ext)) return 'code'
  return 'other'
}

/** 文件条目的路径就存在 text 里，一行一个 */
export function fileInfo(item: ClipItem): FileInfo | null {
  if (item.kind !== 'files') return null
  const paths = (item.text ?? '').split('\n').filter(Boolean)
  if (paths.length === 0) return null

  const first = paths[0]
  const sep = Math.max(first.lastIndexOf('\\'), first.lastIndexOf('/'))
  const name = sep >= 0 ? first.slice(sep + 1) : first
  const dir = sep >= 0 ? first.slice(0, sep) : ''
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''

  return { paths, name, ext, dir, kind: classifyExt(ext) }
}
