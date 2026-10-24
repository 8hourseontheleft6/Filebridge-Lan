# Filebridge-Lan 开发路线图

> 配套文档：[现状审计](./AUDIT.md)
> 代码基线：`d4943e1` · 2026-10-23
> 估算口径：1 名熟悉 TypeScript / Rust 的开发者，含自测，不含应用商店审核与跨平台签名采购

## 进展快照（2026-10-24）

- ✅ **M0 止血**：工作区已提交基线；WebRTC 接收端修正 StreamSaver API 误用并移除 unpkg CDN，大文件统一引导 HTTP；`sendData` 错误不再被吞、`waitForChannel`/背压有超时、接收端 30 s 看门狗；0 字节、取消、对端断开、移动端布局已处理。
- ✅ **M1.0 Spike**：Node HTTP Hub 完成，1 GB 上传/下载哈希一致，Hub 内存 60–85 MB；100 MB、空文件、中文名、Range、CORS、路径清洗均通过。
- ✅ **M1.1（Node 版）**：Hub API + 手机/桌面 HTTP 面板 + 静态托管 + `npm run test:hub` 冒烟测试；390 px 布局通过。
- ✅ **M1.1（Rust 版）**：axum Hub 内嵌 Tauri（`src-tauri/src/hub.rs`，`cargo run --release --bin hub` 可独立验证），API 与 Node 一致；release 1 GB 上传 **2.53 s / 404 MB/s**、下载 **1.54 s**、内存约 9 MB，哈希一致。
- ✅ **UI / 扫码**：首页与房间二维码、`?room=` 自动加入（3 次重试 + 首页错误提示）、上传百分比/速度/剩余时间、复制链接/房间码、状态徽章、空状态；390 px 无横向溢出。
- ✅ **Rust 信令**：`src-tauri/src/signaling.rs` 内嵌 Tauri `:42070`；headless Chrome 验证“桌面创建房间 → 手机扫码自动加入 → P2P 已连接”。
- ✅ **1.1.0 发布**：Tauri NSIS 安装包构建；静默安装/启动/卸载验证通过；真实手机扫码接收 500 MB 视频与 1 GB ISO 成功。
- ✅ **1.1.1 热修复**：修复安装版在 `http://tauri.localhost` 下把 API/信令拼成 `tauri.localhost:42080/42070` 导致离线/无二维码；覆盖安装后首页与房间二维码均验证通过。
- ✅ **1.1.2 下载体验**：桌面端下载改走 Rust 保存，成功/失败 Toast + 打开文件夹；首页设置可自定义下载目录并持久化；同名同大小文件不重复保存；覆盖安装验证通过。
- ✅ **1.1.3 可靠性与可见性**：下载 `.part` + 原子重命名、进度/取消；Hub SSE `/api/events` 推送手机上传进度；修复 stdout 不可用时上传日志 panic 导致响应丢失。
- ✅ **1.2.0 开源发布**：更名 Filebridge-Lan；MIT License、SECURITY/CONTRIBUTING/第三方声明、Windows CI；新应用标识/二进制/数据目录与旧数据迁移；`npm audit` 0 漏洞。
- ✅ **1.2.1 防火墙修复**：定位 `filebridge-lan.exe` Block/Private 规则导致手机无法访问；安装器 UAC hook + 手动修复脚本 + README 排障；Release workflow 自动附 SHA-256。
- ⏳ **未完成**：上传断点续传、token/鉴权、正式浏览器 E2E；代码签名/MSI 待按需补充。
- 性能测试必须用 `--release`：debug 构建的 SHA-256 未优化，1 GB 上传约 38 s（曾误判为 Hub 吞吐问题）。
- 详细 API 与限制见 [HTTP-HUB.md](./HTTP-HUB.md)。

## 0. 目标与非目标

### 0.1 一句话目标

**同一 WiFi 下，电脑和手机之间传大文件，像 AirDrop 一样简单，像本地拷贝一样可靠。**

### 0.2 v1.1 的成功标准（可验收）

1. 双击桌面应用即可用，**不需要安装 Node、不需要联网、不需要手动开两个终端**。
2. 手机扫码打开网页，**电脑 → 手机传 2 GB** 文件，浏览器原生下载，手机内存不随文件大小增长。
3. **手机 → 电脑传 2 GB** 文件，桌面端流式写盘，内存占用保持常量，结束后 SHA-256 一致。
4. 传输中断网 10 秒：能从断点续传，或至少明确失败并可一键重试，**绝不产生"看起来成功、实际损坏"的文件**。
5. 0 字节、中文名、emoji、重名、超长文件名、空格/括号文件名全部正确。
6. 取消、关闭页面、退出应用都有明确状态；任何失败都有中文错误提示，日志里没有未捕获异常。
7. 手机端单栏布局可正常操作；进度、速度、剩余时间可见。
8. `npm run check`（类型检查 + 单测 + Lint）与双端 E2E 通过。

### 0.3 v1.1 明确不做

- ❌ 公网 / 跨网络传输（放到 v2）
- ❌ 文件夹递归、剪贴板同步、多设备广播（放到 v1.2）
- ❌ mDNS / UDP 自动发现（直接砍掉，房间码/二维码足够）
- ❌ PWA 离线、Service Worker（当前形态下没有价值）
- ❌ 自研 E2E 加密协议（先做传输可靠性；安全模型见 ADR-003）
- ❌ WebRTC 局域网直连（冷冻，不作为 v1.1 主链路）

## 1. 架构决策（ADR）

### ADR-001：v1.1 传输主线采用「桌面 Hub + HTTP 流式」

**背景**
- 手机以 `http://<LAN-IP>` 访问时不是 secure context：`crypto.subtle`、`showSaveFilePicker`、Service Worker 全部不可用。
- WebRTC DataChannel 在主流 Chromium 上可以在 HTTP 下工作，但收到的字节仍然要在 JS 里找地方落盘；这正是最近 5 个 commit 反复失败的地方。
- 浏览器对**普通 HTTP 下载**有原生流式落盘能力（点链接 → 浏览器自己写磁盘），对**普通 HTTP 上传**也有原生流式读盘能力（`File` 直接作为请求体）。这两个能力不需要 secure context，也不占 JS 内存。

**决策**
- v1.1 以**桌面端作为 Hub**：桌面应用内嵌一个 HTTP 服务，同时提供 UI、上传、下载、进度事件。
- 手机只做两件事：
  - 上传：`POST /api/upload`，请求体直接是 `File`，用 XHR 拿上传进度；
  - 下载：`<a href="/api/files/:id">`，交给浏览器原生下载器。
- 桌面端用 Rust 流式写盘（`.part` → 校验 → 原子重命名），不经过浏览器内存。
- WebRTC 从主链路移除，代码保留在 `experimental/`，等 v2 跨网络时再启用。

**理由**
| 维度 | 桌面 Hub + HTTP | HTTPS + 保留 WebRTC |
|---|---|---|
| 手机大文件落盘 | 浏览器原生，天然流式 | 依赖 StreamSaver/FSA，iOS 脆弱 |
| 离线局域网 | ✅ 无外部依赖 | ✅ 但需处理证书信任 |
| 首配成本 | 扫码即用 | 需在手机安装/信任根证书 |
| 断点续传 | HTTP Range，标准且简单 | 需自研分块位图 |
| 调试难度 | 低（curl 可复现） | 高（ICE/DTLS/信令） |
| 跨网络 | 需中继/隧道 | WebRTC + TURN 的强项 |
| 代码量 | 少（一个 axum 服务） | 多（信令 + 分块 + 落盘 + 兼容） |

**代价**
- 文件会经过桌面端落盘，不再是严格意义的"纯 P2P"。但在"PC ↔ 手机"的主场景里，桌面本来就是接收方，隐私边界没有变化。
- 需要接受"桌面端是主机"的产品形态；两台手机之间互传不在 v1.1 范围内。

**备选方案**
- **B：HTTPS + 自托管 StreamSaver。** 需要给手机装根证书或使用公网域名 + DNS-01；能保留 WebRTC，但配置成本高，iOS 后台仍可能挂起。作为 ADR-001 被否决后的备选。
- **C：原生 iOS/Android App。** 体验最好，但开发和分发成本最高，暂不考虑。

> ⚠️ 这是一个**需要产品 owner 拍板**的决策。如果坚持"不落盘、纯 P2P"，请直接选 B 或 C，后面的 M1/M2 任务顺序需要重排。

### ADR-002：模块取舍

| 模块 | 决策 | 理由 |
|---|---|---|
| `server/signaling.ts` | 保留，移入 `experimental/webrtc/` | 实测可用，v2 可能复用 |
| `src/transfer/webrtc.ts` | 冷冻，移入 `experimental/webrtc/` | 不作为 v1.1 主链路 |
| `src/transfer/protocol.ts` | 保留类型与常量，重写传输核心 | `TransferQueue` 是空壳 |
| `src/crypto/auth.ts` | 冷冻，移入 `experimental/security/` | 未接线，安全模型要重做 |
| `src/network/discovery.ts` | **删除** | mDNS/UDP 在浏览器不可用，Tauri 端也是空壳 |
| `src-tauri/src/lib.rs` 占位命令 | 删除，替换为真实 hub | 占位实现会误导 |
| `react-router-dom` | 删除依赖 | 未使用 |
| 直接依赖 `esbuild` | 删除 | Vite 已自带 |

原则：**代码树里只保留"正在被运行"的模块。** 冷冻代码放到 `experimental/` 并在 README 写明"不参与构建"。

### ADR-003：安全模型（v1.1）

- **默认信任边界是局域网**，不宣称端到端加密。当前 WebRTC 的 DTLS 只保护传输段；改成 HTTP 后传输是明文，必须在文档里说清楚。
- 房间码 6 位数字 + 一次性会话 token；二维码里带 `http://<ip>:<port>/#<code>:<token>`；token 只存 `sessionStorage`。
- 服务端只 bind 局域网地址；提供"仅本机"开关；默认 10 分钟房间过期；上传大小上限可配。
- 文件名一律 `basename` + 白名单清洗（去控制字符、Windows 保留名、`..`、路径分隔符、超长截断），落盘用随机 ID，展示名与磁盘名分离。
- 限流：每 IP 并发上传数、每秒请求数；拒绝非本机/非房间来源的写操作。
- 可选 TLS：M3 提供"自签名证书 + 指纹确认"开关，默认关闭；文档说明"局域网明文"的风险。
- **不要复活 `auth.ts` 的 ECDH+AES 方案**：它没有认证绑定，防不了信令层 MITM；如果 v2 需要，直接用 TLS 或 PAKE（SPAKE2），不要自创协议。

### ADR-004：桌面端形态

- 用 **Rust + axum** 在 Tauri 进程内启动 hub，默认端口 `42070`，被占用时自动 `42071+`，实际端口写进二维码。
- 生产环境由 axum 直接提供构建后的前端（同源，无 CORS）；Tauri 窗口加载 `http://127.0.0.1:<port>/`。
  - 若 Tauri 对"主窗口加载外部 URL"有限制，退化为"窗口加载 bundled UI + hub 对 `tauri://localhost` 开放 CORS"。
- 开发环境：Vite `:5173` + `/api` 代理到 `:42070`，手机可访问 `http://<ip>:5173` 做 HMR；发布前必须用 hub 同源模式回归一遍。
- Node 只用于开发脚本与实验，不再进入发布包。

## 2. 目标架构

```
┌──────────────────────────── 电脑（Tauri + Rust） ────────────────────────────┐
│  WebView  ── HTTP ──►  axum hub :42070                                       │
│                          ├── GET  /                 前端静态资源              │
│                          ├── GET  /api/info         设备名/版本/局域网 IP/房间码 │
│                          ├── POST /api/rooms        建房 → code + token       │
│                          ├── POST /api/upload       原始 body 流式写盘        │
│                          ├── PUT  /api/upload/:id   Content-Range 续传        │
│                          ├── GET  /api/files/:id    下载（Range / 附件头）     │
│                          ├── GET  /api/events       SSE：进度 / 完成 / 对端    │
│                          └── DELETE /api/upload/:id 取消并清理 .part          │
│  磁盘：<数据目录>/incoming/<id>.part  → 校验 → <展示名>                        │
└──────────────────────────────────────────────────────────────────────────────┘
                                   ▲
                                   │ 同一 WiFi，普通 HTTP
                                   │
┌──────────────────────────── 手机浏览器 ──────────────────────────────────────┐
│  扫码 → 打开页面 → 选文件 → XHR POST（原生流式读盘 + 上传进度）               │
│                  → 文件列表 → 点下载（浏览器原生流式写盘）                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**关键点**
- 手机端不需要 WebRTC、不需要 Service Worker、不需要 `crypto.subtle`、不需要外网 CDN。
- 桌面端不经过 WebView 的内存；Rust 直接把请求体 `tokio::io::copy` 到文件。
- 进度有两条：手机上传进度由 XHR 提供；桌面 UI 的进度由 SSE 推送。

## 3. 里程碑

### M0｜交接止血（0.5–1 天）

**目标**：把仓库和文档恢复到"可信基线"，避免在错误前提上继续开发。

- [ ] 处理工作区未提交改动（提交或还原），打 tag `v1.0.0-baseline`。
- [ ] 重写 git 历史，移除第一次提交里的 `.git_disabled`（331 MB blob），删除 `.git_disabled/`，`git gc` 后确认 `.git` < 5 MB。
- [ ] 如暂不重写历史：至少删除 `.git_disabled/`，并在 README 标注仓库体积问题。
- [ ] 新增 `.gitattributes`（`* text=auto eol=lf`），避免 CRLF 噪声。
- [ ] 修正文档：README 的功能清单改为"已实现 / 规划中"；ARCHITECTURE 标注"目标架构，非现状"；把本审计与路线图加入索引。
- [ ] 删除 `public/` 相关的 404 引用（manifest/favicon），或补齐静态资源。
- [ ] 移除 `index.html` 的 unpkg StreamSaver 引用；在 M1 完成前，大文件接收路径直接给出明确错误，而不是静默丢数据。
- [ ] 建立 `npm run check`：`tsc --noEmit` + Vitest（先放 3–5 个纯函数测试）+ ESLint。
- [ ] 修 D3（0 字节）、D2（取消后继续 ACK）、D8（对端断开 UI）、D10（移动端布局）——这四个是低风险、可立即验证的止血项。

**验收**：工作树干净；`npm run check` 通过；`.git` 体积正常；README 不再声称未实现的能力；0 字节文件不再卡死。

### M1｜技术验证 + Hub MVP（4–6 天）

**目标**：用最小代价证明"HTTP 流式"在真实设备上成立，并交付一个可用的纵向切片。

**M1.0 Spike（1 天，先做，失败就改路线）**
- [ ] 用 Node/axum 起一个最小端点：`POST /upload` 把请求体流式写到磁盘，`GET /download` 流式返回。
- [ ] 用真实 iPhone Safari + Android Chrome，各传 2 GB：
  - 手机上传时内存是否稳定（Safari 开发者工具 / `performance.memory` 仅 Chrome）；
  - 下载是否进入"文件"App，是否支持后台/锁屏；
  - 实测吞吐（目标 ≥ 20 MB/s @ 5 GHz WiFi）；
  - 断网 10 秒后的行为。
- [ ] 记录结果到 `docs/SPIKE-http-streaming.md`，作为 ADR-001 的最终依据。
- [ ] **Go/No-Go**：若 2 GB 上传/下载任一失败且无法在 1 天内解决，立即回到 ADR-001 的备选 B，不要在 M1 上继续投入。

**M1.1 Hub MVP（2–3 天）**
- [ ] 在 `src-tauri` 引入 `axum`、`tokio`、`tokio-util`、`tower-http`；实现上表端点。
- [ ] 上传：原始 body → `<data>/incoming/<id>.part`，边写边算 SHA-256，完成后原子 rename；同名文件自动 `name (1).ext`。
- [ ] 下载：`Content-Length`、`Content-Disposition`（RFC 5987）、`Range`、`ETag`。
- [ ] SSE：`file_added`、`progress`、`completed`、`failed`、`peer_joined`。
- [ ] 房间：6 位数字、10 分钟 TTL、token 校验；`/api/info` 返回所有局域网 IPv4（排除回环/虚拟网卡）。
- [ ] 端口冲突自动顺延；启动时打印 URL 与二维码。
- [ ] 前端 feature flag：`VITE_TRANSPORT=http|webrtc`，默认 `http`；旧 WebRTC 路径暂时保留可回退。

**M1.2 手机端页面（1–2 天）**
- [ ] 上传：`<input type=file multiple>` + 拖放；XHR 进度、速度、剩余时间；取消。
- [ ] 下载：文件列表 + 原生 `<a download>`；显示大小、SHA-256 前 8 位、完成时间。
- [ ] 移动端单栏；大按钮；断线提示；页面关闭前 `beforeunload` 提醒。
- [ ] 桌面端 UI：二维码、房间码、在线设备、接收进度、打开文件夹。

**验收**：在真实 iPhone + Android 上完成 2 GB 双向传输；手机内存不随文件大小增长；桌面内存 < 300 MB；SHA-256 一致；断网后可重试，不产生损坏文件。

### M2｜可靠传输与前端重构（5–7 天）

**目标**：把"能传"变成"传得可靠、出错可解释、代码可维护"。

- [ ] 协议/接口 v2 文档：HTTP 语义 + 上传会话状态机 + 错误码表；WebRTC 模式另附二进制帧格式（magic `FB`、version、type、seq、payloadLen、CRC32C）。
- [ ] 断点续传：`PUT /api/upload/:id` + `Content-Range`；服务端持久化 `.part` 与已收字节；页面刷新后恢复。
- [ ] 重试：指数退避（1s/2s/4s，最多 5 次）；区分"网络错误/磁盘满/权限/文件被占用/校验失败"。
- [ ] 取消：`DELETE` 清理 `.part`；发送端/接收端状态一致。
- [ ] 校验：服务端流式 SHA-256（`sha2` crate）+ 大小校验；前端用 `hash-wasm` 在 Web Worker 计算（HTTP 下也可用），完成后比对；不一致明确报错并保留 `.part` 供排查。
- [ ] 队列：多文件顺序/并发 2；暂停/继续；失败重试；传输历史（最近 100 条，JSON 落盘）。
- [ ] 前端重构：
  - `src/app/`：路由/页面（Home、Room、History、Settings）
  - `src/features/transfer/`：状态机（idle → creating → waiting → transferring → paused → completed/failed）、API client、SSE hook
  - `src/components/`：FileList、ProgressBar、QRCode、EmptyState、ErrorBanner
  - `src/lib/`：格式化、文件名清洗（与 Rust 侧保持同一套规则）、错误映射
- [ ] 删除/冷冻死代码；`noUnusedLocals: true`；补 ESLint 规则（`no-floating-promises`、`no-empty-catch`）。
- [ ] 测试：
  - Vitest：文件名清洗、Range 解析、状态机迁移、错误映射、哈希分块；
  - Playwright：两个 context 完成"上传 → 列表 → 下载 → 校验"；断网/取消/0 字节；
  - Rust：`cargo test` 覆盖 sanitize、range、原子 rename、并发上传。

**验收**：`npm run check` + `cargo test` + Playwright 全绿；手动矩阵中的 P0/P1 场景全部通过；代码中不再有 `catch {}` 静默失败。

### M3｜产品化（5–7 天）

- [ ] Tauri：单实例、托盘、开机自启（可选）、关闭到托盘、防火墙规则提示、端口选择、数据目录设置、打开下载文件夹。
- [ ] 二维码：桌面显示 + 手机扫码直达；二维码包含 IP、端口、房间码、token；多网卡时让用户选择。
- [ ] 设置：设备名、下载目录、最大并发、上传大小上限、是否允许局域网访问、是否启用 TLS（自签名 + 指纹）。
- [ ] 安全加固：token 过期/撤销、Origin/Host 校验、路径穿越测试、上传限流、日志脱敏。
- [ ] 打包：Windows NSIS/MSI，图标/版本/签名（可选），`v1.1.0` 发布说明；macOS/Linux 构建脚本（按需）。
- [ ] 可选：系统通知（传输完成/失败）、声音提示、深色/浅色主题。
- [ ] 文档：用户向 README（含防火墙/多网卡/iPhone 下载位置）、故障排查、隐私说明（局域网明文）。

**验收**：在一台没装 Node/Rust 的 Windows 机器上安装即用；断网环境可用；卸载干净；无外网请求（可用防火墙/抓包验证）。

### M4｜跨网络与可选 P2P（v2，按需）

- [ ] 方案选择：Tailscale/WireGuard 组网（最省事） / Cloudflare Tunnel / 自建 TURN + WebRTC。
- [ ] 若做 WebRTC：复用 `experimental/webrtc/`，补 TURN、ICE 重启、断线重连、鉴权；仍然保留 HTTP 作为回退。
- [ ] 文件夹传输：服务端流式 zip（`async_zip`），或先打包再传；保留目录结构。
- [ ] 剪贴板/文本同步：`POST /api/text`，SSE 推送，长度限制。
- [ ] 多设备/多用户：房间内多端、权限（只读/可写）、设备信任列表。
- [ ] 安全：TLS 默认化、PAKE 配对、审计日志。

## 4. 优先级 Backlog（M0–M2 范围）

| 优先级 | 事项 | 模块 | 估算 |
|---|---|---|---|
| P0 | 重写历史 / 删除 `.git_disabled`（630 MB → <5 MB） | repo | 0.5 d |
| P0 | 0 字节、取消后 ACK、断开 UI、移动端布局 | frontend | 0.5 d |
| P0 | 移除 unpkg StreamSaver + 失败显式报错 | frontend | 0.2 d |
| P0 | HTTP 流式 Spike（2 GB，真机） | hub | 1 d |
| P0 | axum hub：上传/下载/SSE/房间 | rust | 2–3 d |
| P0 | 手机端上传/下载页面 | frontend | 1–2 d |
| P1 | 断点续传 + 重试 + 取消 | hub/frontend | 2 d |
| P1 | SHA-256 流式校验 + hash-wasm | hub/frontend | 1 d |
| P1 | 前端拆组件 + 状态机 | frontend | 2 d |
| P1 | Vitest + Playwright + `npm run check` | test | 1.5 d |
| P2 | 队列/历史/暂停继续 | frontend | 1.5 d |
| P2 | 设置/托盘/自启/二维码 | tauri | 2 d |
| P2 | TLS 可选 + 安全加固 | hub | 2 d |
| P2 | 打包/签名/发布说明 | release | 1–2 d |

## 5. 测试矩阵

| 维度 | 用例 |
|---|---|
| 浏览器 | Windows Chrome/Edge、iOS Safari 17/18、Android Chrome、macOS Safari、Firefox（桌面） |
| 文件大小 | 0 B、1 KB、255 KB、256 KB、257 KB、10 MB、100 MB、1 GB、2 GB、4 GB（按上限） |
| 文件名 | 中文、emoji、空格、`#`、`%`、`?`、255 字符、Windows 保留名（CON/NUL/AUX）、重名、无扩展名 |
| 网络 | 5 GHz WiFi、2.4 GHz、WiFi 切换、断网 10 s、桌面睡眠、手机锁屏、双网卡/VPN、防火墙首次弹窗 |
| 操作 | 取消（0%/50%/99%）、暂停/继续、刷新页面、关标签、退出应用、并发 2 个文件、错误房间码、过期房间码 |
| 完整性 | 正常、服务端篡改一个字节（模拟）、磁盘满、只读目录、文件被占用 |
| 性能 | 吞吐 ≥ 20 MB/s；手机内存 < 300 MB；桌面内存 < 300 MB；CPU < 30%；1 GB 传输进度更新 ≥ 2 Hz |

**自动化分层**
- 单元（Vitest / cargo test）：协议、Range、文件名、状态机、哈希。
- 集成（Playwright）：两个浏览器上下文，走完整上传/下载/取消/断网。
- 手动（每轮发布前）：真机 iPhone + Android 各一台，2 GB 双向，锁屏/断网各一次。

## 6. 工程规范

- **分支**：trunk-based，短分支；合并前 `npm run check` + `cargo test`。
- **提交**：Conventional Commits（`feat:`/`fix:`/`refactor:`/`docs:`/`test:`/`chore:`），一个提交只做一件事。
- **版本**：`package.json`、`src-tauri/Cargo.toml`、`tauri.conf.json` 三处由脚本同步；tag `v1.1.0`。
- **文档**：README = 用户指南；`docs/ARCHITECTURE.md` = as-built；`docs/ROADMAP.md` = 计划；`docs/AUDIT.md` = 交接快照；每次发布更新 CHANGELOG。
- **Definition of Done**：代码 + 测试 + 文档 + 手动矩阵对应行 + 错误提示文案，缺一不可。
- **可观测性**：前端错误边界 + 结构化日志（级别/模块/时间）；不引入遥测，日志只落本地。

## 7. 建议的第一个 Sprint（本周）

| 天 | 任务 | 产出 |
|---|---|---|
| D1 | M0：提交/还原工作区，重写历史（需批准），删 `.git_disabled`，修文档，跑通 `npm run check` | 干净仓库 + 可信文档 + 基线 tag |
| D2 | M1.0 Spike：真机 2 GB HTTP 上传/下载，记录吞吐/内存/断网 | `docs/SPIKE-http-streaming.md` + Go/No-Go |
| D3 | 定稿 ADR 与 API 契约；搭 axum 骨架；Vite proxy | 可 curl 的 `/api/info`、`/api/upload`、`/api/files` |
| D4 | 手机端上传纵向切片 + 桌面 SSE 进度 | 手机 → 电脑 1 GB 成功 |
| D5 | 电脑 → 手机下载 + 取消/失败提示 + 真机回归 | 双向 1 GB 演示 + 问题清单 |

**Sprint 结束标准**：能在一台干净的电脑上启动，手机扫码，双向传 1 GB，全程有进度、可取消、失败有提示；同时产出 spike 报告和下一轮 backlog。

## 8. 需要拍板的决策

1. **主场景**：是否就是"同一 WiFi、电脑作为主机、手机用浏览器"？要不要覆盖 PC ↔ PC？
2. **是否接受 Hub 架构**（文件经电脑落盘，放弃 v1.1 的纯 P2P）？如果必须纯 P2P，是否接受给手机装证书或做原生 App 的代价？
3. **文件上限**：2 GB / 10 GB / 不设限？是否必须断点续传，还是"失败可重试"即可？
4. **桌面形态**：继续投入 Tauri（Rust 内嵌 hub，单 exe），还是只做浏览器工具 + 可选本地服务？
5. **时间优先级**：先做扎实的局域网 v1.1，还是尽快上跨网络（会显著改变 M1–M3 的排序）？
6. **仓库历史**：是否允许重写 git 历史以移除 331 MB blob？（无远端，风险低；会改变所有 commit hash）

> 建议默认选择：1）PC ↔ 手机为主；2）接受 Hub；3）单文件 10 GB + 断点续传；4）保留 Tauri 并内嵌 Rust hub；5）先局域网；6）允许重写。
