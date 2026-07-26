// 界面里的 logo 用的是 resources 下的托盘简化版母版：
// 头部那个只有 24~32px，完整版的胡须和鼻子在这个尺寸下只会糊成一团。
// 直接内联 SVG 而不是 <img src>：省掉一次资源请求，也不用担心
// file:// 下 CSP 的 img-src 'self' 怎么算。
import markup from '@res/logo-tray.svg?raw'

interface Props {
  className?: string
  title?: string
}

export function Logo({ className = '', title }: Props) {
  return (
    <span
      className={`inline-block overflow-hidden [&>svg]:block [&>svg]:size-full ${className}`}
      title={title}
      aria-label="WitchCat Clipboard"
      role="img"
      // 内容来自构建时打包进来的静态文件，不含任何外部输入
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
