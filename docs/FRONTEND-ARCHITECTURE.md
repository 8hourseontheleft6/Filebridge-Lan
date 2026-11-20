# 前端架构与迁移边界

> 状态：**迁移进行中**。本文件描述目标分层、当前真实状态、临时例外清单和迁移规则。
> 1.6.1 稳定基线（HEAD `924842b`）是本次重构的起点。
> 目标分层尚未全部实现；文中「现状」与「目标」严格区分，不把目标写成已完成。

## 1. 分层与依赖方向

```text
UI 组件（components / 各 feature 的 *.tsx）
   │ 只显示状态、收集输入、调用 controller 提供的 action
   ▼
Feature Hook / Controller（use*.ts）
   │ 组合 service、管理 effect 生命周期（轮询、SSE、清理）
   ▼
Application Service（*Service.ts）
   │ 业务规则：状态转换、重试、续传、同步、错误映射、去重
   ▼
API Client（*Api.ts） / Platform Adapter（platform/*）
   │ HTTP 细节：URL、header、超时、状态码；Tauri invoke 只在这里
   ▼
Node Hub / Rust Hub（同一 HTTP 契约）
```

依赖必须单向：上层可以 import 下层，下层**不得**反向 import 上层。

| 层 | 允许 | 禁止 |
|---|---|---|
| `src/components/**` | 通用展示组件、props、样式 | `fetch`/`invoke`/`EventSource`/`API_BASE`、业务状态机 |
| `src/features/**/use*.ts` | React hooks、effect 生命周期、调用 service | 直接拼 HTTP、直接 `invoke`、解释状态码 |
| `src/features/**/*Service.ts` | 业务规则、重试/续传/同步、错误映射 | import react、import 组件、直接 `fetch`/`invoke` |
| `src/features/**/*Api.ts` | `fetch`、URL、header、超时、JSON 解析 | 业务规则、hook、组件 |
| `src/api/**` | 通用 `httpClient`、`ApiError`、各领域 API 模块 | import react/features/components/http |
| `src/platform/**` | 运行环境判断、`API_BASE`、**唯一** Tauri invoke / listen 入口 | 业务规则、import react/features |

## 2. 状态码与错误归属

- **API 层**把 HTTP 响应转换成 `ApiError`（`status` + 业务 `code` + 服务端 message），并区分 timeout / network / invalid-json。
- **Service 层**决定业务语义：401 token 失效要清理什么、409 offset 冲突如何续传、413 大小上限、429 限流提示。
- **Controller**把错误转成界面状态（notice/error），**组件**只渲染字符串。
- 组件内不得出现 `response.status === 401` 这类判断。

`ApiError` 统一保留服务端 `error` 字段（例如 `clipboard_rate_limited`、`upload_offset_mismatch`），不允许吞掉后重新拼字符串。

## 3. 当前真实状态（迁移起点）

### 3.1 已存在、必须保留复用的边界

| 模块 | 职责 | 迁移后去向 |
|---|---|---|
| `src/lib/clipboard.ts` | 剪贴板纯函数（大小、去重、错误文案、系统剪贴板判断） | `features/clipboard/clipboardService.ts` 复用 |
| `src/lib/uploadOffsets.ts` | offset 校正纯函数 | `features/uploads/` 复用 |
| `src/lib/connectionMonitor.ts` | 心跳陈旧、探测失败阈值 | `features/connection/` 复用 |
| `src/http/connect.ts` | 连接请求 HTTP | `api/connectionApi.ts` |
| `src/relay/api.ts` | Relay HTTP 唯一出口 | 保持，归入 `features/relay/relayApi.ts` 或保留原地 |
| `src-tauri/src/clipboard.rs` `downloads.rs` `network_profile.rs` `discovery.rs` `lan_service.rs` | Rust 侧已拆分的能力 | 保留，Hub 服务化后继续复用 |

### 3.2 仍承担过多职责的文件

| 文件 | 行数 | 混合的职责 |
|---|---|---|
| `src/http/HttpTransfer.tsx` | 2089 | 文件列表、上传队列、XHR/Fetch 分块、offset 续传、重试/取消/删除、下载与保存、Tauri 调用、SSE 生命周期、速率统计、大量 UI（session/pairing 已于 E1 迁出） |
| `src/relay/RelayTransfer.tsx` | 554 | UI + 加密分片 + 传输状态机 |

已迁移（阶段 C）：`src/http/ClipboardPanel.tsx` 从 404 行降到 142 行，只剩布局与本地输入状态；
通信与同步逻辑进入 `src/features/clipboard/`（controller 293 行、service 243 行、types 20 行），
该文件已不在 allowlist 中。

已迁移（阶段 D）：

| 文件 | 迁移前 | 迁移后 | 逻辑去向 |
|---|---|---|---|
| `src/App.tsx` | 402 | 347 | `features/network/useNetworkGate.ts`（5s 轮询、签名重置、dismiss） |
| `src/components/SettingsPanel.tsx` | 223 | 117 | `features/settings/{settingsService,useSettings}.ts` |
| `src/http/NearbyComputers.tsx` | 157 | 85 | `features/connection/useNearbyComputers.ts`（2s 轮询） |
| `src/http/ConnectPanel.tsx` | 183 | 38 | `features/connection/useConnectRequest.ts` |
| `src/http/HostApprovalGate.tsx` | 67 | 16 | `features/connection/useHostApproval.ts`（2s 轮询） |
| `src/http/ConnectApproval.tsx` | 88 | 81 | 仅类型迁到 `features/connection/types.ts` |

已迁移（阶段 E1）：

| 项 | 迁移前 | 迁移后 |
|---|---|---|
| `src/http/HttpTransfer.tsx` | 2236 | **2089** |
| session/pairing 逻辑 | 内联在组件中 | `features/session/{sessionService,useSessionController,types}.ts` |

`src/features/session/` 职责：sessionStorage key、URL hash 配对码、桌面 loopback session 读取、
配对与 token 持久化、Hub 重启后的自动恢复（3s）、配对码轮换、`expireToken`、
`acceptConnectedToken`、子窗口 `filebridge-peer-connected` postMessage、StrictMode/卸载竞态清理。
HttpTransfer 现在只调用 `useSessionController` 暴露的状态与 actions，并保留配对区展开、
`showCode`、手动输入框 UI 与「配对成功但读文件失败」的文件预检回调。

删除的旧文件：`src/http/connect.ts`（并入 `src/api/connectionApi.ts`）、`src/lib/hub.ts`
（运行环境判断与 `API_BASE` → `platform/runtime.ts`；`fetchHubInfo` → `api/infoApi.ts`；
手机地址函数 → `features/network/lanAddress.ts`）。

### 3.3 临时例外清单（Architecture allowlist）

`scripts/check-architecture.mjs` 中的 `ALLOWLIST` 是唯一合法的例外来源。当前 **1 个文件**（阶段 E 目标）：

```text
src/http/HttpTransfer.tsx       tauri-invoke, tauri-core-import, tauri-event-import,
                                http-fetch, api-base, event-source
```

规则：**只减不增**。每迁移一个文件，必须在同一提交里删掉对应 allowlist 条目；新增条目必须在提交说明里给出理由。

## 4. 迁移阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| A | 架构文档 + `check:architecture` 门禁 + 基线记录 | 已完成 |
| B | `platform/runtime`、`api/httpClient`、`api/errors`、`platform/tauri`、各领域 API 模块 + 测试 | 已完成 |
| C | 剪贴板纵向切片（api/service/controller + 面板改造） | 已完成（UI 四态回归待补） |
| D | 设置、网络门禁、连接模块 | 已完成 |
| E | HttpTransfer 拆分：E1 session、E2 files、E3 upload、E4 download、E5 SSE、E6 UI | E1 已完成；E2 files 为下一步 |
| F | Relay 模块 | 待开始 |
| G | Rust Hub 服务化 | 待开始 |
| H | Node Hub 服务化 + 双端契约 fixture | 待开始 |
| I | 收尾、性能、可访问性、文档 | 待开始 |

每个阶段结束时必须：测试通过 → `npm run check:architecture` 通过 → 审阅 diff → 单独提交。

## 5. 目标目录

```text
src/
  app/            AppShell、路由组合
  platform/       runtime.ts（环境与 API base）、tauri.ts（唯一 invoke）、tauriEvents.ts（唯一 listen）
  api/            httpClient.ts、errors.ts、infoApi.ts、sessionApi.ts、filesApi.ts、
                  uploadApi.ts、downloadApi.ts、clipboardApi.ts、connectionApi.ts、networkApi.ts
  features/
    session/  files/  uploads/  downloads/  clipboard/
    connection/  network/  settings/  relay/
  components/     纯展示组件（Button、Icon、Dialog、RateCard、JoinQr、BrandMark…）
  styles/
```

各 feature 内部约定：`*Api.ts`（传输）→ `*Service.ts`（业务）→ `use*.ts`（controller）→ `*.tsx`（UI）。

## 6. HTTP / Tauri 契约约束（不得改变）

- 端点、方法、状态码、错误 code、大小限制、TTL、限流规则与 1.6.1 完全一致。
- 上传：`201` 完成、`200` 未完成分块、`409` offset 冲突（带服务端 offset）。
- 剪贴板：`401` 未授权、`403 clipboard_host_only`、`409` 无变化、`413` 超限、`429` 限流；`source` 由服务端推导。
- 文字只存内存，不进日志、URL、SSE 事件或诊断。
- Node Hub 与 Rust Hub 必须继续一致；共享 fixture 位于 `scripts/fixtures/`。
- `docs/HTTP-HUB.md` 与 `docs/CLIPBOARD.md` 是契约事实来源，改动需与两端同步。

## 7. 检查方式

```bash
npm run check:architecture   # 边界扫描；legacy 例外见脚本 ALLOWLIST
npm run check                # tsc
npm run build
# 完整门禁见 README「测试」章节
```

扫描规则：

1. `invoke(` 与 `@tauri-apps/api/core` 只允许在 `src/platform/tauri.ts`；
2. `@tauri-apps/api/event` 只允许在 `src/platform/tauriEvents.ts`；
3. `fetch(` 只允许在 `src/api/**`、`src/features/**` 和 `src/relay/api.ts`；
4. `API_BASE` 只允许在 `src/platform/runtime.ts` 与 `src/api/**`；
5. `new EventSource(` 只允许在 `src/features/**` 的事件传输模块；
6. `src/api/**` 不得 import react/features/components/http/App；`src/platform/**` 不得 import react/features/components；feature service 不得 import react/components。
