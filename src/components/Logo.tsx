// 界面顶部使用完整母版，保留渐变、投影和立体边框；
// Windows 系统托盘仍单独使用 logo-tray.svg 的高辨识度简化版。
// 直接内联 SVG 而不是 <img src>：省掉一次资源请求，也不用担心
// file:// 下 CSP 的 img-src 'self' 怎么算。
import markup from '@res/logo.svg?raw'

interface Props {
  className?: string
  title?: string
}

export function Logo({ className = '', title }: Props) {
  return (
    <span
      className={`inline-block overflow-hidden [&>svg]:block [&>svg]:size-full ${className}`}
      title={title}
      aria-label="Witch Clipboard"
      role="img"
      // 内容来自构建时打包进来的静态文件，不含任何外部输入
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
