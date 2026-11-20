# Filebridge-Lan 架构

> 1.6.0 现状：局域网 HTTP Hub + 配对码/bearer token + 分块续传 + 文字同步；跨网络加密中继为实验性。WebRTC 房间已移除。

## 局域网

```text
手机浏览器
   │ HTTP（明文，局域网）
   ▼
Rust axum Hub (:42080)
   ├─ /api/session        loopback + 本机 Origin，桌面读取配对码
   ├─ /api/pair           配对码 → 256-bit token（12h）
   ├─ /api/info           公开：版本/端口/IP/文件数
   ├─ /api/files          token 校验 → 文件元数据
   ├─ /api/upload         token 校验 → 流式写盘 + SHA-256（201）
   ├─ /api/upload/chunk   token 校验 → 分块续传（200 未完成 / 201 完成）
   ├─ /api/upload/chunk/:id  token 校验 → 查询已确认 offset / 取消上传
   ├─ /api/events         token 校验 → SSE 上传进度 + 5s heartbeat
   ├─ /api/files/:id      token 校验 → 下载/Range/删除
   ├─ /api/clipboard      token 校验 → 文字同步读/写/清空
   ├─ /api/clipboard/enabled  token + 仅 loopback → 开关文字同步
   ├─ /api/connect/requests   连接请求（创建/查询/主机批准）
   └─ dist/              静态页面（SPA）
   │
   ▼
Downloads/Filebridge-Lan（或用户选择的下载目录）
```

- **没有 WebRTC、没有 42070 信令、没有房间**
- 手机扫码链接带 `#code=...`；fragment 不发送到服务器
- 桌面端通过 loopback + 本机 Origin 获取配对码；手机没有这个权限
- 文件 API 使用 `Authorization: Bearer`；SSE/下载使用 `token` 查询参数
- 上传类端点在 Node Hub 与 Rust Hub 使用同一契约：`201` 表示已创建，分块未收完返回 `200`
- Host/Origin 白名单拒绝 DNS rebinding、null Origin 和任意域名
- CORS 不再使用 `*`

## 跨网络

```text
发送方（Tauri/网页）
   │ AES-256-GCM 分片加密
   ▼
Bridge Relay（:43000，HTTPS 反向代理）
   ├─ 传输码/TTL/配额
   └─ 密文分片
   ▲
   │ 接收方打开 https://relay/#receive=CODE&key=...&token=...
接收方（手机浏览器）
```

- 中继只保存密文；key 和 downloadToken 在 URL fragment
- 非 loopback 直连 HTTP 被拒绝；必须 HTTPS
- 中继仍是实验性，未完成真实 WAN 验证；详见 `CROSS-NETWORK.md`

## 组件

| 组件 | 位置 |
|---|---|
| Tauri 桌面壳 | `src-tauri/` |
| Rust Hub | `src-tauri/src/hub.rs` |
| 原生保存/下载目录 | `src-tauri/src/downloads.rs` |
| React UI | `src/` |
| HTTP 直传 | `src/http/HttpTransfer.tsx` |
| 跨网络中继客户端 | `src/relay/` |
| Node Hub（开发/自托管） | `server/hub.mjs` |
| 加密中继服务 | `server/bridge.mjs` |

## 当前代码结构（1.6.1 基线）

前端仍以「组件直接通信」为主，分层重构正在进行，详见 `FRONTEND-ARCHITECTURE.md`。

| 文件 | 行数 | 当前职责 |
|---|---|---|
| `src/http/HttpTransfer.tsx` | 2236 | session/token、文件列表、上传队列、分块与续传、下载、SSE、Tauri 调用、速率统计、UI |
| `src/relay/RelayTransfer.tsx` | 554 | 中继传输 UI + 加密分片状态机 |
| `src/App.tsx` | 402 | 布局 + 网络门禁（直接 `invoke`） |
| `src/http/ClipboardPanel.tsx` | 379 | 文字同步 UI + `fetch`/`invoke` + 轮询 |
| `src/components/SettingsPanel.tsx` | 202 | 设置 UI + `invoke` |
| `src/http/NearbyComputers.tsx` | 143 | 附近电脑 UI + `invoke` 轮询 |
| `src-tauri/src/hub.rs` | 1874 | Rust Hub：路由、鉴权、状态、文件存取、上传/下载、剪贴板、连接请求 |
| `server/hub.mjs` | 1156 | Node Hub：与 Rust 相同的领域混在一个文件 |

已拆分的边界（保留复用）：`src/lib/clipboard.ts`、`src/lib/uploadOffsets.ts`、
`src/lib/connectionMonitor.ts`、`src/http/connect.ts`、`src/relay/api.ts`、
`src-tauri/src/{clipboard,downloads,network_profile,discovery,lan_service}.rs`。

## 目标结构（重构进行中，尚未实现）

```text
UI 组件 → Feature Hook/Controller → Application Service
        → API Client / Tauri Platform Adapter → Node Hub / Rust Hub
```

- 前端目标目录、依赖方向、临时例外与迁移阶段见 `FRONTEND-ARCHITECTURE.md`；
- 后端目标：`src-tauri/src/hub/`（http handlers、services、storage、events、error）与
  `server/`（http router/security/responses、features、stores）按领域拆分。
- 边界由 `npm run check:architecture` 强制（legacy 例外清单只减不增）。

## 端口

| 端口 | 用途 |
|---|---|
| 42080 | 局域网 HTTP Hub |
| 43000 | 跨网络 Bridge Relay（可选） |
| 5173 | Vite 开发服务器（可选） |

## 安全边界

- 局域网 HTTP 是明文；配对码/token 只是访问控制，不是加密
- 不要把 42080 暴露到公网
- 跨网络必须使用 HTTPS Relay；中继仍是实验性
- 原生下载通过 Tauri 命令直接读 Hub 数据目录，不经过 HTTP token

## 电脑互联

- Rust 桌面 Hub 通过 UDP 42081 广播发现信息（设备名、稳定实例 ID、Hub 端口、版本）
- 前端“附近电脑”卡片轮询 Tauri `discovery_peers`，点击后在应用内嵌入目标 Hub 页面
- 浏览器路径直接打开目标 Hub 地址，通过“请求主机允许”发起同一连接请求
- Node/Rust 共用连接请求协议：创建请求、查询状态、主机批准/拒绝、签发 token
- 主机确认只在 loopback 接口读取和处理
- 发现失败、无 UDP、AP 隔离时保留 IP/二维码/手动配对码回退