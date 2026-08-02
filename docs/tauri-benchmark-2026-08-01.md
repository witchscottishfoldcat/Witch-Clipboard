# Tauri POC 首轮基准（2026-08-01）

## 环境与口径

- 系统：当前 Windows 机器，同一登录会话。
- UI：两边都显示完整 React 面板，等待 20 秒后采样。
- Electron：当前工作树构建产物，使用独立 `WCC_DEMO_USER_DATA_DIR`。
- Tauri：Release 构建，内存历史，不访问正式数据。
- 内存：统计根进程及其全部后代的 Working Set 和 Private Memory 总和。
- 这些是一次探索性采样，不是稳定的性能结论；还需要自动化重复采样、冷/热启动分组和中位数/p95。

## 结果

| 指标 | Electron | Tauri POC | 首轮判断 |
| --- | ---: | ---: | --- |
| Windows x64 NSIS | 103.28 MB | 1.34 MB | Tauri 减少约 98.7% |
| 主程序文件 | 约 215 MB（未打包目录中的 Electron EXE） | 3.33 MB | Tauri 明显更小 |
| 20 秒后进程数 | 4 | 7 | Tauri/WebView2 更多 |
| Working Set 合计 | 358.16 MB | 451.19 MB | Tauri POC 高约 26% |
| Private Memory 合计 | 204.80 MB | 254.93 MB | Tauri POC 高约 24% |

## 解读

安装包目标已经被原型显著验证，但“换 Tauri 就一定更省内存”在这台机器上没有成立。
Tauri 使用系统 WebView2，去掉 Release 控制台进程后仍观察到 6 个 WebView2 子进程；
Electron 当前完整面板有 3 个子进程。关闭 `arboard` 的图片特性没有改变安装包体积，
说明当前体积主要由 Tauri 壳、React 资源和 NSIS 压缩结果决定。

1.34 MB 安装包使用 WebView2 `downloadBootstrapper`：目标机器已有 WebView2 时体积优势成立；
没有 WebView2且离线时不能完成运行时安装。若改用离线或固定 WebView2，安装包会明显增大。

正式 Go/No-Go 前需要：

1. 连续采样至少 10 次，剔除首次 WebView2 初始化影响；
2. 分别测量窗口可见、窗口隐藏和纯托盘三种状态；
3. 确认 WebView2 子进程是否存在共享/预热成本；
4. 对两边使用相同的单窗口生命周期策略；
5. 测量面板首次显示和再次显示的 p50/p95；
6. 加入图片、文件、SQLCipher 后重新测量安装包和内存。

因此当前结论是：**体积方向通过，内存方向暂未通过。**

## 已完成的运行时验证

- Release 可执行文件连续运行稳定；原先因正式版占用 `Alt+V` 导致的启动崩溃已修复。
- 快捷键冲突时自动回退到 `Ctrl+Alt+Shift+V`，连续隐藏/显示验证通过。
- 真实端到端文字往返通过：系统剪贴板 → Rust 临时历史 → React 选择 → Tauri command → 系统剪贴板。
- 原型使用独立应用 ID 和纯内存历史，验证过程没有读取或写入正式数据库。

## 第二轮：接近真实后端（同日）

第二轮已静态链接与 Electron 相同的 SQLite3MultipleCiphers/sqleet、兼容 Chromium
safeStorage/DPAPI 的密钥读取、AES-256-GCM Blob、PNG 编解码、事件驱动监听、文件剪贴板和自动粘贴。
对正式数据只执行只读兼容测试；运行时采样使用 `out/tauri-full-test` 隔离目录。

| 指标 | 第一轮文字 POC | 第二轮真实后端预览 |
| --- | ---: | ---: |
| Windows x64 NSIS | 1.34 MB | 2.29 MB |
| 主程序 | 3.33 MB | 5.56 MB |
| 20 秒后进程数 | 7 | 7 |
| Working Set 合计 | 451.19 MB | 409.94 MB |
| Private Memory 合计 | 254.93 MB | 308.14 MB |

第二轮安装包 SHA-256：`CF0EFC873EC77D88DA75C39BA40EFE61F794BBE7C67FB0F1C74D99E76B8FE06A`。
进程强制结束 3 秒后后代进程为 0。单次样本仍只用于方向判断；正式结论需要重复采样。

重要更正：现有 Electron 数据库由 `better-sqlite3-multiple-ciphers` 创建，默认密码算法是
SQLite3MultipleCiphers 的 `sqleet`，不是 Zetetic SQLCipher 的磁盘格式。Rust 端必须复用相同实现，
普通 `rusqlite + bundled-sqlcipher` 无法直接打开现库。

## 正式重构构建（第三轮）

第三轮加入完整持久化、HTML、跨设备、双窗口、签名 updater、在线迁移备份和按目标架构编译的
SQLite3MultipleCiphers。主窗口不再随后台进程创建；由于仅销毁窗口不会终止共享 WebView2 环境，
Release 在全部面板隐藏 60 秒且未运行跨设备服务时快速重启为空壳后台态。

最终数据由仓库脚本重复采样，使用随机隔离数据目录与专用测试热键：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\benchmark-tauri.ps1 -Iterations 10
```

| 指标 | Electron 1.5.0 | Tauri 正式重构 |
| --- | ---: | ---: |
| Windows x64 NSIS | 103.28 MB | 3.18 MB |
| 主程序 | 约 215 MB | 8.00 MB |
| 隐藏冷启动进程数 | — | 1 |
| 隐藏 Working Set | — | 14.98 MB |
| 隐藏 Private Memory | — | 2.64 MB |
| 完整冷启动 | — | p50 993.6 ms / p95 1051.5 ms（10 次） |
| 空壳后台首次唤出 | — | 652.5 ms |
| 已有 WebView 的热唤出 | 31.8/36.2 ms（旧口径） | p50 24.6 ms / p95 31.4 ms（10 次） |
| 完整面板 Working Set | 358.16 MB | 411.31 MB |
| 完整面板 Private Memory | 204.80 MB | 313.70 MB |
| 隐藏 65 秒后 | — | 1 进程；14.65 MB / 2.60 MB |

结论：安装包与长期后台常驻显著胜出；面板显示期间 WebView2 内存仍高于 Electron，不能宣称所有状态都更省内存。
旧 Electron 对照与新自动化脚本的窗口检测口径不同，因此不宣称 Tauri 热唤出已胜过 Electron。
迁移决策仍以保守数据接受首次唤出延迟，以换取 96.9% 的安装包缩减和约 15 MB 的长期后台态。
最终未签名 x64 NSIS SHA-256：`F335B8C1AB7E574A442867E0130FC0AF380AAD3DCB51464E29FE2D837F0D1088`。
