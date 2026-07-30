// 界面与系统图标共用高保真光栅母版，保留 WitchDrawer 同系列的材质和光影。
// 界面载入 256px 派生图，避免把 1254px 母版重复塞进渲染层产物。
import logoUrl from '@res/icon-256.png'

interface Props {
  className?: string
  title?: string
}

export function Logo({ className = '', title }: Props) {
  return (
    <img
      src={logoUrl}
      className={`block object-contain ${className}`}
      title={title}
      alt=""
      aria-label="Witch Clipboard"
      role="img"
      draggable={false}
    />
  )
}
