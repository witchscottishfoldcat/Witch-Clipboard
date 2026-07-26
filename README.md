<img src="resources/icon-256.png" width="120" alt="WitchCat Clipboard" align="right" />

# WitchCat Clipboard

**Windows 剪贴板管理器。托盘常驻，单击弹出预览，`Alt+V` 唤出完整面板；文字、图片、文件自动入库，本地加密存储，可搜索可标签，选中回车就贴回刚才那个窗口。**

复制过的东西不该丢在一个只记得最后一次的剪贴板里。这个项目做的就是：把你复制过的一切留下来、
让你三秒内找回它、并且这些内容只留在你自己的机器上——数据库用 SQLCipher 加密，主密钥由
Windows DPAPI 绑定到你的用户账户，没有账号、没有云、没有联网。

## 它能做什么

| | |
| --- | --- |
| **自动采集** | 文字、图片（截图）、文件都自动入库；同一内容重复复制只上浮不重复存 |
| **两种面板** | 单击托盘出迷你预览（340×470），`Alt+V` 出完整面板（820×540） |
| **自动分类** | 链接 / 代码 / 颜色（带色块）/ 路径 / 邮箱 / 数字 / 图片 / 文件，各有徽标 |
| **中文搜索** | FTS5 trigram 分词，能搜中文子串；1~2 字的短词自动回退扫描 |
| **文件与大文件** | 只记录路径不复制内容，复制 10 GB 视频库里也只多一行；粘出去是真文件 |
| **贴回去** | `Enter` 自动切回原窗口并模拟 `Ctrl+V`，`Alt+1…9` 快贴前九条 |
| **整理** | 置顶（永不清理）、标签、按类型/标签筛选、全键盘操作 |
| **本地加密** | SQLCipher 数据库 + AES-256-GCM 图片，密钥受 DPAPI 保护 |
| **自动清理** | 按条数 / 天数保留，孤儿图片文件一并回收 |
| **隐私** | 带「不要记录」标记的剪贴板（密码管理器）和黑名单程序的复制不入库 |

## 安装 / 运行

安装包在 `release/WitchCat-Clipboard-0.1.0-setup.exe`（NSIS，可选安装位置，卸载不删数据）。

从源码跑：

```bash
npm install          # 会自动为 Electron 重建原生模块
npm run dev          # 开发模式（面板会自动亮出来）
npm run selftest     # 在真实 Electron 里跑 57 项断言
npm run typecheck    # 类型检查
npm run build        # 构建 out/ 产物
npm run dist         # 打 NSIS 安装包到 release/
npm run icons        # 重新生成图标
```

> Electron 二进制若下载失败，用镜像补装：
> `$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'; node node_modules/electron/install.js`
> 打包时若下载工具链失败：`$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'`

**环境要求**：Windows 10/11 x64。开发需要 Node 22+。

## 键位

| 键 / 操作 | 作用 |
| --- | --- |
| **单击托盘图标** | 弹出**迷你预览面板**（贴着托盘图标），再单击收起 |
| 双击托盘图标 | 直接打开完整面板 |
| 右键托盘图标 | 迷你面板 / 完整面板 / 全部收起 / 退出 |
| `Alt+V` | 唤出 / 收起完整面板（全局，可在设置里改） |
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
- **完整面板**（`Alt+V`）：820×540，带筛选栏、标签编辑、原图预览、条目详情和操作按钮。

两个窗口共用同一份渲染层产物，靠 `?mode=mini` 切布局。

**点到别处就收起**：焦点离开面板（点桌面、点别的程序、Alt+Tab）时自动隐藏。
开发时想让面板留着不动，用 `WCC_NO_AUTOHIDE=1 npm run dev`。

## 文件与大文件

复制文件（资源管理器里 Ctrl+C）会作为 `files` 条目入库：

- **只记录路径，不复制文件内容**——所以复制一个 10 GB 的视频，库里增加的只是一行路径
- 界面上显示文件名、大小、所在目录；文件夹图标可以在资源管理器里定位
- 粘贴时写回的是真正的 `CF_HDROP`，所以粘出去是**文件本身**（可以直接粘进微信、资源管理器），
  不是一段路径文本。原生写入失败时会退回写路径文本，不会静默什么都不做
- 文件被移动或删除后，条目还在，路径就失效了——这是「剪贴板历史」的语义，不是文件管理器

## 自动更新

以 GitHub Releases 为源，**一切都要你点**：

- 设置页「关于与更新」里有**检查更新**按钮，显示当前版本，结果如实回报
  （已是最新 / 有新版本 / 失败原因 / 开发模式不支持）
- 启动后延迟 12 秒自动查一次，查不到或出错都不打扰
- 查到新版本只提示，**不会先偷偷下 100 MB**（`autoDownload = false`），
  也不会在你关掉应用时悄悄装上（`autoInstallOnAppQuit = false`）
- 下载要点「下载更新」，装要点「重启并安装」
- 点了**「暂不更新」**就记住这个版本号，之后启动不再提示同一个版本；
  手动检查仍然如实报告，不会因为你跳过就骗你说「已是最新」

> 安装包没有代码签名，更新时 Windows 会再弹一次 SmartScreen 提示。

## 数据存放在哪

`%APPDATA%\WitchCat-Clipboard`（设置页里有「打开数据目录」按钮）：

| 文件 | 内容 |
| --- | --- |
| `clipboard.db` | SQLCipher 加密数据库：条目、标签、缩略图、全文索引 |
| `blobs/<前2位>/<sha256>.bin` | AES-256-GCM 加密的原图，内容寻址、自动去重 |
| `master.key` | 主密钥，用 Windows DPAPI 封装（绑定当前用户账户） |
| `settings.json` | 界面与行为设置，明文 |

从旧版本（叫 ZTB 时）升级会自动把 `%APPDATA%\ztb` 里的数据搬过来，只搬不删。

## Logo

<img src="resources/icon-256.png" width="88" alt="logo" />

一个形状同时读出三层意思：**剪贴板的「夹子」就是巫师帽，「板面」就是猫脸**。
所以它既是剪贴板、又是猫、又带着巫师的帽子，正好对上 WitchCat 这个名字。

| | |
| --- | --- |
| 底板 | 靛蓝 → 紫罗兰渐变 `#6366f1 → #a855f7`，和界面里的强调色是同一套 |
| 猫脸 / 板面 | 纯白圆角矩形，两只耳朵从板面下方探出来 |
| 巫师帽 | 深靛 `#1b1740`，向左倾 16°，帽带用琥珀 `#f59e0b` 提一口气 |
| 五官 | 靛蓝 `#4f46e5`：眼睛、鼻子，胡须半透明 |

设计母版是 SVG，PNG 全部由它光栅化生成，**不存在两份互相打架的设计源**：

| 文件 | 用途 |
| --- | --- |
| `resources/logo.svg` | 母版（完整细节） |
| `resources/logo-tray.svg` | 托盘专用简化版：去掉胡须、鼻子、帽带，帽子和眼睛放大一档——16~32px 下细节只会糊成一团 |
| `resources/icon.png` / `icon-256.png` | 应用图标、安装包图标、README |
| `resources/tray.png` / `tray@2x.png` | 托盘图标（`nativeImage` 按 `@2x` 约定自动挑高分屏那张） |

改完 SVG 跑 `npm run icons` 重新生成。光栅化用的是 Electron 自带的 Chromium——
它本来就在依赖里，不用再引 sharp/resvg 这类要编译的东西；画到 canvas 再取
`toDataURL`，拿到的是真正带 alpha 的位图。

## 技术栈

Electron 43 · React 19 · TypeScript 7 · Tailwind CSS 4 · Vite 7（electron-vite）·
better-sqlite3-multiple-ciphers（SQLCipher）· koffi（免编译调 Win32）· electron-builder

```
electron/
  main/      窗口、迷你面板、托盘、热键、IPC、剪贴板监听、粘贴回写、Win32 绑定、自检
  data/      加密、blob 仓库、SQLite（建表/迁移）、仓库实现、保留策略
  preload/   contextBridge 白名单，渲染进程拿不到 node
  shared/    三方共用的类型契约与内容分类
src/         渲染进程（App = 完整面板，MiniApp = 迷你面板）
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
- **数据目录固定成一个名字**：Electron 默认的 userData 路径来自应用名，开发时取 `package.json`
  的 `name`、打包后取 `productName`，两者不一致就会读到两个不同的库。所以显式 `setPath` 到
  `%APPDATA%\WitchCat-Clipboard`。
- **`safeStorage` 在 Windows 上并不只绑用户账户**：它的加密密钥存在 profile 的 `Local State`
  文件里（再由 DPAPI 保护）。所以「换数据目录」等于「换了一把随机密钥」，搬过去的 `master.key`
  会解不开——迁移时必须把 `Local State` 一起带过来。这一条是改名时踩出来的，不踩一次很难想到。
- **「点到别处就收起」不能只靠 `blur` 事件**：从托盘唤出时，Windows 的前台窗口抢占限制可能让
  窗口显示了却拿不到焦点，那就永远不会 blur，面板怎么点都不消失。所以除了 blur，还有一个
  看门狗每 200ms 问系统「现在前台窗口属于哪个进程」，不是自己就收起。
  关键的安全条件是**必须先确认自己拿到过前台**才允许收起——否则「一直没抢到焦点」会被误判成
  「用户点了别处」，面板会自己莫名消失。这几个分支在 `npm run selftest` 里都有断言。
- **剪贴板文件列表只能自己读**：Electron 的 clipboard API 拿不到 `CF_HDROP`，所以用 koffi
  调 `OpenClipboard` + `DragQueryFileW` 读，用 `GlobalAlloc` + 手搓 `DROPFILES` 结构写。
  采集时文件要**先于文本判断**——资源管理器复制文件时往往同时带一份路径文本，
  先看文本就会把「复制了一个视频」记成一条普通字符串。
- **托盘单击有个必须处理的竞态**：点托盘图标时面板会先因失焦自动收起，紧接着才收到 `click`
  事件。少了「刚被收起就忽略这一下点击」的冷却判断，用户点托盘想收起面板，面板会立刻又弹回来、
  永远收不掉。这条不变量由 `toggleFromTray()` 自己保证，并且在自检里有断言。
- **自动粘贴**用 `keybd_event` 而不是 `SendInput`：koffi 里描述 INPUT 联合体成本高，
  收益为零。发 Ctrl+V 之前会先释放残留的修饰键，否则 `Alt+V` 唤出面板时按着的 Alt
  会让目标程序收到 Ctrl+Alt+V。
- **数据库打不开时**（master.key 丢了 / 换了 Windows 账户）不静默丢数据：弹窗让用户选，
  旧库改名成 `clipboard.db.locked-<时间戳>` 保留。真的建不了库时降级到内存存储，界面会明确标出来。

## 验证

没有引入测试框架，验证集中在 `npm run selftest`——它在**真实 Electron 运行时**里跑 57 项断言，
覆盖加密往返与篡改检测、内容分类、去重、FTS/LIKE 搜索与转义、标签、图片解密一致性、保留策略与
blob 回收、`CF_HDROP` 真实往返、托盘单击竞态、点到别处收起的全部分支。

端到端手工验证过的路径：文字/图片/文件自动入库、记事本自动粘贴（含中文）、外部进程能把粘出去的
内容读成真文件、打包版正常运行、焦点离开后面板自动消失。

## 安全边界（诚实说明）

- 加密防的是「别人拿到你的 db 文件后直接读内容」。主密钥绑定当前 Windows 用户账户，
  同一账户下运行的任何程序都能解密——这挡不住已经在你账户里跑的恶意软件。
- 敏感内容跳过基于两条：剪贴板的 `ExcludeClipboardContentFromMonitorProcessing` 等标记
  （主流密码管理器会写），以及来源进程名黑名单。**不是 100% 可靠**：不写标记又不在黑名单里的
  程序，复制的内容照样会入库。别把它当成防泄漏机制。
- 卸载不会删数据目录，需要彻底清除请手动删 `%APPDATA%\WitchCat-Clipboard`。

## 已知限制

- **只做了 Windows。** `electron/main/win32.ts` 在非 Windows 上整体降级：没有序列号监听、
  没有自动粘贴、读不到文件列表。
- **Win11 可能把托盘图标收进「溢出」区**，那样就看不到也点不到图标。这时右键任务栏 →
  任务栏设置 → 系统托盘图标 → 其他系统托盘图标 → 把 WitchCat Clipboard 打开。图标在溢出区时
  `tray.getBounds()` 返回 0，程序会退回「在光标附近弹出」并在日志里警告。
- `Ctrl+,` 打开设置在中文输入法激活时可能被 IME 吞掉，用齿轮按钮。
- 渲染包约 970 KB（React + motion 为主）。本地加载无感，没做拆包。
- 安装包约 102 MB，其中绝大部分是 Electron 运行时本身。

## 版本历史

见 [CHANGELOG.md](./CHANGELOG.md)。
