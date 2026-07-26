# ZTB · 粘贴板

本地优先的 Windows 剪贴板管理器。托盘常驻，`Alt+V` 唤出面板，文字与图片持久化、可搜索、可打标签。

## 运行

```bash
npm install          # 会自动为 Electron 重建原生模块
npm run dev          # 开发模式（面板会自动亮出来）
npm run typecheck    # 类型检查
npm run build        # 打包三端产物到 out/
npm run icons        # 重新生成图标与演示图片
```

> Electron 二进制若下载失败，用镜像补装：
> `$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'; node node_modules/electron/install.js`

## 键位

| 键 | 作用 |
| --- | --- |
| `Alt+V` | 唤出 / 收起面板（全局） |
| 直接打字 | 搜索 |
| `↑` `↓` / `PgUp` `PgDn` | 移动选中项 |
| `Enter` | 粘贴选中项 |
| `Alt+1…9` | 快贴列表前 9 条 |
| `Ctrl+C` | 复制到剪贴板（不粘贴） |
| `Ctrl+P` | 置顶 / 取消置顶 |
| `Del` | 删除 |
| `Esc` | 先清搜索词，再收起面板 |

## 架构

```
electron/
  main/      主进程：窗口、托盘、热键、IPC、仓库、粘贴回写
  preload/   contextBridge 白名单，渲染进程拿不到 node
  shared/    三方共用的类型契约与内容分类
src/         渲染进程（React 19 + Tailwind 4 + motion）
scripts/     零依赖 PNG 图标生成器
```

关键约定：`ItemStore` 是一个接口（`electron/main/store.ts`）。P0 用 `MemoryStore`（内存 + 演示数据），
P1 换成 SQLite 实现同一接口，IPC 与渲染层不需要改动。

## 路线图

- [x] **P0 骨架** — 无边框亚克力面板、托盘、全局热键、IPC、演示数据、键盘全操作、原生模块重建跑通
- [ ] **P1 采集与存储** — 剪贴板轮询、SQLite + FTS5、内容寻址图片仓库、sha256 去重、缩略图
- [ ] **P2 界面完善** — 已在 P0 一并完成主体；剩余：图片多尺寸预览、标签管理页
- [ ] **P3 粘贴回写** — koffi + Win32 `SendInput`，还原前台窗口后模拟 `Ctrl+V`
- [ ] **P4 加密与清理** — safeStorage 主密钥、SQLCipher、blob AES-256-GCM、敏感内容跳过、保留策略
- [ ] **P5 打包** — electron-builder NSIS 安装包、开机自启、图标

## 当前限制（P0）

- 数据在内存里，**重启会重置**；SQLite 持久化在 P1。
- 还没有监听系统剪贴板，列表是演示数据；采集在 P1。
- `Enter` / 粘贴按钮目前只把内容写进系统剪贴板，**不会自动 Ctrl+V**；自动粘贴在 P3。
- 设置页只有外观、清空历史；热键自定义与保留策略在 P4。
