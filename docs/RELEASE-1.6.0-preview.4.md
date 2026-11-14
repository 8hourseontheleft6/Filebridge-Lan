# Filebridge-Lan 1.6.0 Preview 4

发布日期：2026-11-14（Draft，未发布）

这是一个 **Preview 候选**，用于验收。它把文字同步补到可交付状态、修掉两个真实缺陷，并完成 1.6.0 的界面收尾。真实手机、真实双机与跨网络环境仍未按本构建验收。

## 本轮实际完成

### 文字同步（Issue #2）

- **安全修复：`source` 不再由客户端决定。** 服务端按连接推导来源（loopback → `desktop`，其余 → `phone`），客户端传来的 `source` 被忽略。修复前，远端调用方可以自称 `desktop` 从而抑制主机的系统剪贴板写入。
- **Node 与 Rust Hub 行为对齐。** 写入检查顺序统一为「限流 → 未开启 → 超长 → 格式错误」，两端返回相同状态码与 `code`；边界、限流、鉴权、去重、清空、no-log 均有等价断言。
- **会话失效立即清空。** `GET /api/clipboard` 返回 401/403 时，面板丢弃旧文本并提示重新配对；断线或 Public 暂停同样清空；token 变化时面板整体重置，不会把上一连接的内容带进新连接。
- **桌面侧本地拦截超长文本。** 系统剪贴板文本超过 262144 字节时本地拒绝并提示，不再反复提交换回 413。
- **面板层级按验收要求重排**：最新文本 → 复制（主操作）→ 发送文本 → 从剪贴板读取 → 清空 → 关闭同步；后三项收进分隔线下方的弱化行，危险/低频动作不再与复制、发送同权重。

### 界面收尾

- 侧栏分「传输方式 / 应用」两组：局域网直传是主入口；跨网络中继为次要入口（浅色 + 「实验」徽标），**浏览器客户端与 ≤1000px 窄屏不显示**；进入中继页有实验性提示条与「返回局域网直传」。
- 触屏选择热区 44×44（复选框可见方框仍为 18px），圆形图标按钮触屏 44px。
- 上传已取消/失败时进度块标题分别显示「已取消」「上传失败」。

### 修复的真实缺陷

1. **文字同步来源可伪造**（见上）。
2. **所有按钮常驻 `scale(0.97)`**：上一轮清理废弃 CSS 时把 `.btn / .btn-icon-round / .side-nav-item` 三个选择器误留在 `:active` 规则前，导致按钮常驻 97% 缩放、44px 触控目标实际只有 42.7px。已恢复 transition 规则并单独保留 `:active` 缩放，实测按钮高度恢复 44px。

## 文字同步协议

- `POST /api/clipboard` 的 body 只需要 `{ "text": "..." }`；`source` 由服务端推导。
- 单条上限 **262144 字节（UTF-8）**；超出 `413 clipboard_too_large`。
- 写入限流：全局 30 次/分钟、单 IP 10 次/分钟；超出 `429 clipboard_rate_limited`。
- 未开启时 `409 clipboard_disabled`；非法请求 `400 clipboard_bad_request`。
- 只有 `POST /api/clipboard/enabled` 需要 loopback（远端 `403 clipboard_host_only`），其余端点与文件 API 一样只校验 bearer token。
- 文本只存在 Hub 内存：不落盘、不进发现广播、不进 URL、不进普通日志、不进 SSE 文件事件或上传诊断。
- 去重按 SHA-256，内容不变不递增 `revision`，避免两端回显循环。

### 浏览器限制（未变，不属于缺陷）

- 手机端不承诺后台静默复制：复制必须由用户点击触发，权限被拒时保留文本并提供手动复制。
- 「从剪贴板读取」同样受浏览器权限约束，失败后仍可手动粘贴或输入。

## UI 变更

- 文字同步卡片：动作层级与边界说明（仅当前已批准连接、只存内存、默认开启可随时关闭、局域网 HTTP 明文）。
- 侧栏导航分组与中继入口弱化。
- 触控目标修正。
- 截图已按本构建重拍：`docs/screenshots/desktop-1440.png`、`desktop-900.png`、`mobile-390.png`、`settings-1440.png`、`guide-dialog.png`、`upload-recovery.png`。
- 文字同步的证据截图：`docs/screenshots/clipboard-long-text-1440.png`（长文本换行）、`clipboard-error-1440.png`（会话失效后清空并提示）、`clipboard-offline-1440.png`（断网后「已暂停」且文本清空）、`clipboard-390.png`（手机宽度下的按钮尺寸与换行）。

## 自动化测试结果（本构建实际运行）

| 命令 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `npm run build` | 通过 |
| `npm run test:version` | `VERSION_OK 1.6.0-preview.4` |
| `npm run test:clipboard` | 7 项通过（新增） |
| `npm run test:connection` | 通过 |
| `npm run test:offsets` | 通过 |
| `npm run test:hub` | `HUB_SMOKE_OK`（含文字同步鉴权/主机限定/source 推导/边界/限流/去重/清空/no-log） |
| `npm run test:resume` | `RESUME_SMOKE_OK` |
| `npm run test:bridge` | `BRIDGE_SMOKE_OK` |
| `npm run test:firewall` | `FIREWALL_INSTALLER_TEST_OK` |
| `cargo test` | 26 通过 / 1 忽略 |
| `cargo check` | 通过（1 条既有弃用警告） |

附加的界面自动验证（headless，非真机）：

- 文字同步 UI 链路：输入 → 发送 → 最新文本显示 → 清空 → 显示「暂无文本」。
- 长文本（3200 字符）不产生横向溢出，`scrollWidth == clientWidth`。
- 会话失效（注入 401）：文本被清空并显示「连接已失效，请重新配对后再同步」。
- 网络离线（CDP 断网 13 秒）：状态变为「已暂停」且文本清空。
- 390px 下按钮实测高度 44px，无横向溢出。

## 仍需用户验收（未完成，不要当作已验证）

- **真实手机**（iPhone Safari / Android Chrome）用本构建复测：复制与读取权限、锁屏与后台切换、390×844 实际布局、长文本与 emoji 显示。
- **真实双机**：附近发现 → 主机批准 → 传输 → 保存 的完整链路。
- **Windows 系统剪贴板双向链路**：开启同步后复制 → 手机看到 → 手机发送 → 系统剪贴板写入。本轮只做了协议与界面层验证，没有在真实桌面窗口里跑通整条链路。
- **Public 网络暂停/恢复、断线重连**的真实网络行为。
- 多网卡 / VPN / AP 隔离环境。
- Windows 10、触屏笔记本、900×600 窗口的实际观感与焦点顺序。
- 跨网络中继的真实 WAN 验证（仍为实验性）。
- 安装包未签名，Windows SmartScreen 可能提示。

## 安装

- 安装包由 CI 从 tag 构建，文件名 `Filebridge-Lan_1.6.0-preview.4_x64-setup.exe`，SHA-256 见 Release 正文。
- 安装器内置防火墙规则：规则已指向安装目录 exe 时重装/升级完全静默；首次安装或规则失效时才需要一次管理员授权。
- 本构建为 Draft，未公开发布。
