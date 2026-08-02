# ADR 0001：将默认桌面外壳迁移到 Tauri 2

- 状态：已接受，发布签名与覆盖安装验收待完成
- 日期：2026-08-01
- 决策范围：桌面外壳与原生运行时，不改变产品数据语义

## 背景

Witch Clipboard 1.5.0 使用 Electron 43。当前 Windows x64 NSIS 安装包约 103 MB；
应用又属于长期驻留托盘的轻量工具，因此下载体积、更新流量、空闲内存和冷启动都是核心体验指标。

现有实现已经具备经过自检覆盖的 SQLCipher 数据库、AES-256-GCM Blob、Win32 文件剪贴板、
来源识别、自动粘贴、托盘竞态处理和失焦收起逻辑。迁移不能以牺牲这些行为为代价。

## 决策

保留 Electron 作为显式回滚构建，同时将默认开发、构建和分发入口切换到 Tauri 2：

1. 复用现有 React 渲染层，不重写 UI。
2. 正式应用标识保持 `com.witchcat.clipboard`，数据目录保持 `%APPDATA%\WitchCat-Clipboard`。
3. Rust 直接实现窗口、托盘、快捷键、剪贴板、存储、加密、跨设备和更新适配。
4. Electron 构建脚本改名保留，不再作为默认发布入口。
5. 数据升级前必须创建可验证的加密在线备份；任何密钥错误都禁止静默重建。

1.5 的正式支持范围为 Windows x64 与 Windows ARM64。当前 Rust 后端依赖 DPAPI、
`CF_HDROP`、Win32 前台窗口恢复和注册表自启；在完成 Keychain、`NSPasteboard`、辅助功能权限与
LaunchAgent 对等实现前，不提供 Tauri macOS 构建。Electron macOS 脚本仅作历史回滚入口。

## 目标架构

最终 Rust 核心应独立于 Tauri，并拆分为以下边界：

- `clipboard-core`：统一条目模型、分类、去重和应用服务。
- `platform-win` / `platform-macos`：剪贴板监听、来源识别、窗口和粘贴。
- `storage`：SQLCipher、FTS5、迁移、保留策略。
- `crypto`：系统密钥存储、密钥派生和加密 Blob。
- `sync`：客户端加密操作日志、内容寻址 Blob、WebDAV 传输。
- `tauri-app`：窗口、托盘、快捷键和前后端命令适配，不承载业务规则。

当前代码已经按 Rust module 隔离上述边界；后续只有在出现第二个前端壳或第二个平台实现时再拆成独立 crate，避免为了目录结构增加发布复杂度。

## Go / No-Go 门槛

只有同时满足下列条件才进入正式迁移：

- Windows x64 安装包不超过 25 MB。
- 空闲工作集不超过 Electron 基线的 60%。
- 面板唤出延迟的 p95 不高于 Electron 基线。
- 文字、图片、HTML、`CF_HDROP` 文件列表均能真实往返。
- 来源识别、自动粘贴、托盘切换和失焦收起行为无回退。
- 现有 SQLCipher 数据库、`master.key` 和加密 Blob 兼容测试 100% 通过。
- Windows x64 与 ARM64 都能由 CI 构建。
- Electron 到 Tauri 的过渡更新能失败回滚，不产生第二份用户数据。

若体积达标但稳定性或数据兼容性不达标，则保留 Electron，不推进正式替换。

### 唤出延迟门槛例外

最终测试显示，Electron 保留 renderer 时旧口径热唤出 p95 为 36.2 ms；Tauri WebView 已存在时新口径
p95 为 31.4 ms，而无 WebView 后台态首次按需创建为 652.5 ms。由于两个热态数据口径不同，且首次唤出明显更慢，
仍视为没有严格满足“p95 不高于 Electron”的原始门槛。
本次决策接受这一项例外，因为产品讨论明确把安装包和长期后台常驻作为更高优先级，且首次唤出仍低于
750 ms、后续低于 50 ms。若未来首次唤出超过 750 ms 或热态超过 100 ms，应撤销空壳重启策略或改用
独立 UI helper 进程，不得用提前显示空白窗口伪造指标。

## 数据安全约束

- 测试和基准必须用 `WCC_TAURI_DATA_DIR` 隔离；正式构建使用 `%APPDATA%\WitchCat-Clipboard`。
- 不允许创建明文正式数据库或明文图片仓库。
- 便携版不能以关闭加密作为实现方式。
- WebDAV 同步必须在客户端加密后上传；服务端不得获得剪贴板明文。
- 迁移工具只能复制或原地读取数据，不能自动删除旧数据。

## 发布过渡

Tauri 更新格式与 Electron Updater 不兼容。正式迁移时需要最后一个 Electron 过渡版本：

1. 下载并验证 Tauri 安装程序；
2. 退出 Electron；
3. 以相同正式应用标识执行覆盖安装；
4. 启动 Tauri 并执行只读兼容检查；
5. 检查失败时保留并恢复 Electron，不改动用户数据。

## 当前基线

- Electron Windows x64 安装包：约 103.28 MB。
- 类型检查：通过。
- Electron 自检：98 通过 / 0 失败（当前工作树）。
- 已知测试噪声：退出流程会打印未注册 IPC handler 错误，但当前退出码仍为 0。
- 当前源码规模：约 6,657 行 TypeScript/TSX/CSS。

最终 x64 NSIS 为 3.18 MB。隐藏启动不创建 WebView，仅 1 个进程、14.98 MB Working Set；
完整 React 面板显示时 WebView2 总 Working Set 仍约 411 MB。单纯销毁 Tauri window 不会释放共享 WebView2
环境，因此 Release 在所有面板隐藏 60 秒、且跨设备服务未运行时执行一次带标记的快速重启，重启后
不创建 WebView，将长期常驻恢复为轻量 Rust 进程。仓库自动化脚本 10 次采样为：完整冷启动
p50/p95 993.6/1051.5 ms；纯后台首次按需创建 WebView 652.5 ms；后续热唤出 p50/p95 24.6/31.4 ms。
与 Electron 的旧基准检测口径不同，不做跨口径胜负结论。

最终未签名 x64 NSIS SHA-256：`F335B8C1AB7E574A442867E0130FC0AF380AAD3DCB51464E29FE2D837F0D1088`。
