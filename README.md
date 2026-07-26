# ZTB · 粘贴板

本地优先的 Windows 剪贴板管理器。托盘常驻，`Alt+V` 唤出面板，文字与图片自动入库、可搜索、可打标签，数据加密落盘。

## 运行

```bash
npm install          # 会自动为 Electron 重建原生模块
npm run dev          # 开发模式（面板会自动亮出来）
npm run selftest     # 在真实 Electron 里跑存储层自检（41 项断言）
npm run typecheck    # 类型检查
npm run build        # 构建 out/ 产物
npm run dist         # 打 NSIS 安装包到 release/
npm run icons        # 重新生成图标
```

> Electron 二进制若下载失败，用镜像补装：
> `$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'; node node_modules/electron/install.js`
> 打包时若下载工具链失败：`$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'`

## 键位

| 键 / 操作 | 作用 |
| --- | --- |
| `Alt+V` | 唤出 / 收起面板（全局，可在设置里改） |
| **单击托盘图标** | 弹出**迷你预览面板**（贴着托盘图标，340×470），再单击收起 |
| 双击托盘图标 | 直接打开完整面板 |
| 右键托盘图标 | 迷你面板 / 完整面板 / 全部收起 / 退出 |
| 直接打字 | 搜索 |
| `↑` `↓` / `PgUp` `PgDn` / `Home` `End` | 移动选中项 |
| `Enter` | 粘贴选中项到刚才那个窗口 |
| `Alt+1…9` | 快贴列表前 9 条 |
| `Ctrl+C` | 只复制到剪贴板，不粘贴 |
| `Ctrl+P` | 置顶 / 取消置顶 |
| `Del` | 删除 |
| `Ctrl+,` | 打开设置（中文输入法激活时可能被 IME 吞掉，用齿轮按钮） |
| `Esc` | 先清搜索词，再收起面板 |

## 两个面板

- **迷你预览面板**（单击托盘）：340×470，一屏能扫到最近 8 条左右。文字看首行、图片看缩略图、
  文件看名字 + 大小 + 所在目录。直接打字即搜索，`↑↓` 选择，`Enter` / 双击粘贴，`Alt+1…9` 快贴，
  右上角箭头展开成完整面板。
- **完整面板**（`Alt+V`）：820×540，带筛选栏、标签、原图预览、条目详情和操作按钮。

两个窗口共用同一份渲染层产物，靠 `?mode=mini` 切布局。

## 文件与大文件

复制文件（资源管理器里 Ctrl+C）会作为 `files` 条目入库：

- **只记录路径，不复制文件内容**——所以复制一个 10 GB 的视频，库里增加的只是一行路径
- 界面上显示文件名、大小、所在目录；`+` 号旁的文件夹图标可以在资源管理器里定位
- 粘贴时写回的是真正的 `CF_HDROP`，所以粘出去是**文件本身**（可以直接粘进微信、资源管理器），
  不是一段路径文本。原生写入失败时会退回写路径文本，不会静默什么都不做
- 文件被移动或删除后，条目还在，路径就失效了——这是「剪贴板历史」的语义，不是文件管理器

## 架构

```
electron/
  main/      窗口、托盘、热键、IPC、剪贴板监听、粘贴回写、Win32 绑定、自检
  data/      加密、blob 仓库、SQLite（建表/迁移）、仓库实现、保留策略
  preload/   contextBridge 白名单，渲染进程拿不到 node
  shared/    三方共用的类型契约与内容分类
src/         渲染进程（React 19 + Tailwind 4 + motion）
scripts/     零依赖 PNG 图标生成器
```

### 几个关键取舍

- **剪贴板监听**用 Win32 `GetClipboardSequenceNumber` 判断有没有变化。这个调用极便宜，
  所以 400ms 轮询在空闲时几乎不耗 CPU——不用每次都去解码剪贴板内容。拿不到原生能力时退化成内容指纹比对。
- **搜索**走 FTS5，分词器选 `trigram`。默认的 `unicode61` 切不开中文，中文子串搜不到；
  trigram 可以，但最短 3 字符，所以 1~2 字的关键词回退到转义后的 `LIKE` 扫描。
- **图片**内容寻址：`blobs/<hash 前 2 位>/<hash>.bin`，同一张图只存一份。
  数据库里只放缩略图，原图按需解密。
- **加密**：主密钥 32 字节随机，用 `safeStorage`（Windows DPAPI）保护后落盘；
  数据库走 SQLCipher，图片走 AES-256-GCM，两者用不同的派生子密钥。
- **剪贴板文件列表只能自己读**：Electron 的 clipboard API 拿不到 `CF_HDROP`，所以用 koffi
  调 `OpenClipboard` + `DragQueryFileW` 读，用 `GlobalAlloc` + 手搓 `DROPFILES` 结构写。
  采集时文件要**先于文本判断**——资源管理器复制文件时往往同时带一份路径文本，
  先看文本就会把「复制了一个视频」记成一条普通字符串。
- **托盘单击有个必须处理的竞态**：点托盘图标时面板会先因失焦自动收起，紧接着才收到 `click`
  事件。少了「刚被收起就忽略这一下点击」的冷却判断，用户点托盘想收起面板，面板会立刻又弹回来、
  永远收不掉。这条不变量由 `toggleFromTray()` 自己保证，并且在 `npm run selftest` 里有断言。
- **自动粘贴**用 `keybd_event` 而不是 `SendInput`：koffi 里描述 INPUT 联合体成本高，
  收益为零。发 Ctrl+V 之前会先释放残留的修饰键，否则 `Alt+V` 唤出面板时按着的 Alt
  会让目标程序收到 Ctrl+Alt+V。
- **数据库打不开时**（master.key 丢了 / 换了 Windows 账户）不静默丢数据：弹窗让用户选，
  旧库改名成 `ztb.db.locked-<时间戳>` 保留。真的建不了库时降级到内存存储，界面会明确标出来。

## 安全边界（诚实说明）

- 加密防的是「别人拿到你的 db 文件后直接读内容」。主密钥绑定当前 Windows 用户账户，
  同一账户下运行的任何程序都能解密——这挡不住已经在你账户里跑的恶意软件。
- 敏感内容跳过基于两条：剪贴板的 `ExcludeClipboardContentFromMonitorProcessing` 等标记
  （主流密码管理器会写），以及来源进程名黑名单。**不是 100% 可靠**：不写标记又不在黑名单里的
  程序，复制的内容照样会入库。别把它当成防泄漏机制。
- 卸载不会删数据目录（`%APPDATA%\ztb`），需要彻底清除请手动删。

## 进度

- [x] **P0 骨架** — 无边框亚克力面板、托盘、全局热键、IPC、键盘全操作
- [x] **P1 采集与存储** — 剪贴板监听、SQLite + FTS5(trigram)、内容寻址图片仓库、sha256 去重、缩略图
- [x] **P2 界面** — 虚拟列表、搜索、类型/标签筛选、置顶、原图预览、操作反馈、空库引导
- [x] **P3 粘贴回写** — 焦点还原 + 模拟 Ctrl+V（已在记事本实测通过，含中文）
- [x] **P4 加密与清理** — DPAPI 主密钥、SQLCipher、blob AES-256-GCM、敏感跳过、保留策略、完整设置页
- [x] **P5 打包** — electron-builder NSIS 安装包、开机自启

## 已知限制

- **Win11 可能把托盘图标收进「溢出」区**，那样就看不到也点不到图标。这时右键任务栏 →
  任务栏设置 → 系统托盘图标 → 其他系统托盘图标 → 把 ZTB 打开。图标被收进溢出区时
  `tray.getBounds()` 返回 0，程序会退回「在光标附近弹出」并在日志里警告。

- 只做了 Windows。`electron/main/win32.ts` 在非 Windows 上整体降级：没有序列号监听、没有自动粘贴。
- 渲染包约 950 KB（React + motion 为主）。本地加载无感，没做拆包。
- 没有单元测试框架，验证靠 `npm run selftest`（真实 Electron 运行时里的 41 项断言）。
