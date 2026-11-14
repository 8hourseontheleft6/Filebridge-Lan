# Filebridge-Lan HTTP Hub

> 状态：Node + Rust 双实现；Rust 已内嵌 Tauri
> 端口：`42080`（只有 Hub，不再有 42070 信令）
> 代码：`server/hub.mjs`（Node）· `src-tauri/src/hub.rs`（Rust）· 前端：`src/http/HttpTransfer.tsx` · 冒烟测试：`scripts/hub-smoke.mjs`

## 1. 为什么是 HTTP

手机通过 `http://<局域网IP>` 访问时不是 secure context，`crypto.subtle`、`showSaveFilePicker`、Service Worker 都不可用。HTTP 利用浏览器原生能力：

- **上传**：`File` 直接作为 `POST` 请求体，浏览器从磁盘流式读取，JS 只拿进度事件
- **下载**：普通 `<a href>`/导航，浏览器自己流式写磁盘
- **电脑侧**：Node/Rust 都是流式写盘，内存不随文件大小增长

1.4.0 起不再提供 WebRTC 房间；大文件、小文件统一走 HTTP。

## 2. UI 结构

- 传输方式在侧栏“传输方式”分组里选：第一项“局域网直传”（主入口），第二项“跨网络中继”（实验性、次要样式、带“实验”徽标）；浏览器客户端不显示中继入口
- 局域网模式以二维码和在线状态为主；配对码放在“手动连接 / 连接详情”折叠区
- 二维码链接默认隐藏 code，可点击“显示 code / 隐藏 code”直接查看或隐藏
- 状态：读取中、需要配对、连接中、在线、授权过期、服务不可用
- 只有扫码失败时才需要手动输入 6 位配对码

## 3. 启动

```bash
npm run build
npm run hub     # http://0.0.0.0:42080
```

或 `npm run dev:all`（Hub + Vite）。

- 桌面：`http://localhost:5173` 或 `http://localhost:42080`
- 手机：`http://<电脑IP>:42080`
- 数据目录：`.filebridge-lan-data/`（可用 `FILEBRIDGE_LAN_HUB_DATA` 覆盖）

### Rust 版（Tauri 内嵌）

Tauri 启动时自动在 `:42080` 拉起 Rust Hub；数据目录默认为系统下载目录下的 `Filebridge-Lan/`。

## 4. 配对与 token

Hub 启动时生成 6 位数字配对码，只保存在进程内存中。

- 桌面端：`GET /api/session`，仅接受 loopback + 本机 Origin，返回 `{ "code": "123456" }`
- 桌面/手机：`POST /api/pair`，body `{ "code": "123456" }`
  - 成功返回 `{ "token": "...", "expiresAt": 1234567890 }`
  - token 为 256-bit 随机值，12 小时过期
- 文件 API：`Authorization: Bearer <token>` 或 `X-Filebridge-Token`
- SSE：`/api/events?token=...`（EventSource 不能设置请求头）
- 下载：`/api/files/:id?token=...`（浏览器原生下载不能设置请求头）
- 轮换：`POST /api/session/rotate`（仅 loopback）→ 新配对码，清空所有 token

错误/缺失 token 返回 `401`；配对失败按 IP 10 次/分钟、全局 300 次/分钟限流，超出 `429`。6 位码只用于配对，不能直接访问文件 API。

Host/Origin 白名单：

- Host：`localhost`、`127.0.0.1`、`::1`、本机实际 LAN IP；端口必须是 42080
- Origin：`http://tauri.localhost`、Hub 自身源、Vite 开发源（5173）
- 拒绝 `null` Origin、任意域名、DNS rebinding、`Access-Control-Allow-Origin: *`

## 5. API

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/info` | 否 | 名称、版本、端口、局域网 IPv4、文件数 |
| GET | `/api/session` | loopback | 桌面读取 6 位配对码 |
| POST | `/api/session/rotate` | loopback | 轮换配对码并清空 token |
| POST | `/api/pair` | 配对码 | 换取 12h bearer token |
| GET | `/api/files` | token | 文件元数据数组 |
| POST | `/api/upload?name=<文件名>` | token | 请求体 = 文件字节；流式写盘 + SHA-256 |
| POST | `/api/upload/chunk?name=&id=&offset=&total=` | token | 分块上传；请求体 = 单个分块字节 |
| GET | `/api/upload/chunk/:id` | token | 查询服务端已确认 `offset`；已完成时返回文件元数据 |
| DELETE | `/api/upload/chunk/:id` | token | 取消上传并清理临时分块；`204` |
| GET | `/api/events?token=` | token | SSE 上传事件 |
| GET | `/api/files/:id?token=` | token | 下载；支持 `Range` |
| DELETE | `/api/files/:id` | token | 删除文件与元数据 |
| GET | `/api/clipboard` | token | 读取文字同步快照 |
| POST | `/api/clipboard` | token | 写入纯文本 `{ text }`；256 KiB 上限 |
| DELETE | `/api/clipboard` | token | 清空文本，保留开启状态 |
| POST | `/api/clipboard/enabled` | token + 仅 loopback | 切换文字同步开关；远端调用 `403` |
| GET | `/` | 否 | `dist/` 静态页面（SPA fallback） |

### 上传

```http
POST /api/upload?name=test.bin
Content-Type: application/octet-stream
Content-Length: 104857600
Authorization: Bearer <token>

<二进制请求体>
```

成功（201）：

```json
{
  "id": "6eb04fab-5996-4faa-81fa-d4c0c5a1041d",
  "name": "test.bin",
  "size": 104857600,
  "sha256": "2fd12da5...",
  "mime": "application/octet-stream",
  "createdAt": 1792745882777
}
```

### 下载

- 无 Range：`200` + `Content-Length` + `Content-Disposition`
- Range：`206` + `Content-Range`
- 非法 Range：`416`

### 分块上传（断点续传）

前端上传统一走分块：桌面 4 MB 一块，iOS Safari 2 MB 一块（并改用 Fetch + Blob 传输）。分块按 `id` 存在临时目录，只有服务端确认的 `offset` 才算已保存。

```http
POST /api/upload/chunk?name=test.bin&id=<uuid>&offset=0&total=104857600
Content-Type: application/octet-stream
Authorization: Bearer <token>

<分块字节>
```

响应：

```json
{ "id": "...", "offset": 4194304, "complete": false, "file": null }
```

- 未收完：`200`，返回当前 `offset` 与 `complete: false`
- 最后一个分块：`201`，服务端计算 SHA-256、把临时文件转成正式文件并写入元数据，返回 `complete: true` 与 `file`
- `offset > 0` 但服务端已有字节数不匹配时返回 `409`（`{"offset": <服务端字节数>}`），先查 `/api/upload/chunk/:id` 拿到真实 offset 再继续
- 单个分块超过 `total` 返回 `400`（Rust Hub 会把临时文件回滚到该分块写入前的长度）
- `id` 必须是合法 UUID；取消用 `DELETE /api/upload/chunk/:id`（`204`，清理 `.part`）

续传只用服务端确认的 offset，不用浏览器侧计数；失败重试 4 次后前端保留 `继续上传` 入口。

### 文字同步

已批准连接内的纯文本同步，默认开启、可随时关闭，手机不能自行开启。

- 只有 `POST /api/clipboard/enabled` 需要 loopback，其余 `/api/clipboard*` 与文件 API 一样校验 bearer token
- 关闭同步会清空内存中的文本；`GET` 在关闭时返回 `enabled: false`，其余字段为 `null`
- `POST /api/clipboard` 的 body 只需要 `{ "text": "..." }`；`source` 由服务端按连接推导（loopback → `desktop`，其余 → `phone`），客户端传入的 `source` 会被忽略
- 单条上限 **256 KiB**（262144 字节，按 UTF-8 计）；超限 `413 clipboard_too_large`
- 写入限流：全局 30 次/分钟、每 IP 10 次/分钟；超出 `429 clipboard_rate_limited`；未开启时 `409 clipboard_disabled`
- 服务端按 SHA-256 去重，内容不变时不递增 `revision`，避免两端回显循环
- 仅存内存，不落盘，不进入发现广播、URL、普通日志或上传诊断
- Node Hub（`server/hub.mjs`）与 Rust Hub（`src-tauri/src/hub.rs`）是同一协议；细节与浏览器限制见 `CLIPBOARD.md`

### SSE

`text/event-stream`，事件名 `upload`：

```json
{ "id": "...", "name": "test.bin", "loaded": 1048576, "total": 10485760, "status": "progress" }
```

`status` 为 `started | progress | completed | failed`。

另有每 5 秒一次的 `heartbeat` 事件（`data: {}`），用于让客户端区分「连接还在但没有传输」和「连接已断」；客户端 10 秒无任何事件即主动探测主机。

## 6. 安全

- 只用于可信局域网；HTTP 明文
- 不要把 42080 暴露到公网
- 配对码/token 不要发到公开群聊；二维码只在可信设备间传递
- 跨网络使用独立的加密中继，见 `CROSS-NETWORK.md`

## 7. 测试

```bash
npm run test:hub
```

覆盖：配对码、Host/Origin、配对 token、401、上传/SHA-256、分块续传（真实 offset 校正）、下载、Range、空文件、文件名清洗、CORS、删除、轮换、配对限流。

## 8. 电脑互联（1.5.3）

### 连接请求 API

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/connect/requests` | Host/Origin | 发起连接；body `{ "name": "Windows 电脑" }`，返回 `requestId/requestSecret/expiresAt` |
| GET | `/api/connect/requests` | 仅 loopback | 主机读取待确认请求；不返回 secret/token |
| GET | `/api/connect/requests/:id` | `X-Connect-Secret` | 发起方查询 pending/approved/denied/expired；批准后返回 token |
| POST | `/api/connect/requests/:id/decision` | 仅 loopback | body `{ "approve": true/false }`；重复决策返回 409 |

请求默认 **60 秒**过期，只能批准一次；pending 上限 8；创建请求按 IP 10 次/分钟 + 全局 120 次/分钟限流。请求 secret 和 token 不写入日志。

### 局域网发现

Rust 桌面 Hub 使用 **UDP 42081** 广播：

```json
{"app":"filebridge-lan","version":"1.5.3","id":"稳定实例ID","name":"DESKTOP-A","port":42080}
```

广播不包含配对码、token、文件名、用户名或路径。发现失败不影响扫码、手动配对和直接 IP 访问。

**网络门禁：** 只有实际承载 Filebridge 的 Private/Domain 网络才启动 UDP 发现和局域网 HTTP Hub。Public/未知网络下不会创建 42081 发现线程，也不会在局域网接口启动 42080 Hub；前端仍会打开并提示改用专用网络。网络切回 Private 后由后台监控自动恢复，不要求重启应用。关闭提示弹窗不会重新启动服务。

### 防火墙

- TCP 42080：Private/Domain
- UDP 42081：Private/Domain
- 程序级规则；不允许 Public/Any
- 安装器/修复脚本已更新，但真实 UAC/防火墙验证仍需人工完成
### 定向广播与发现状态

发现服务除全局 `255.255.255.255` 外，会读取 Windows `GetAdaptersAddresses` 的 IPv4 前缀，向每个有效子网的定向广播地址发送：例如 `192.168.2.43/24` 同时发往 `192.168.2.255:42081`。跳过 loopback、link-local、无效前缀、`/31`、`/32` 和重复目标。目标每 5 秒重新枚举，适配 Wi-Fi 重连、IP 或前缀变化。单个目标发送失败只记录错误，不终止线程，也不清空已有 peer。

本地查询命令 `discovery_status` 返回：

- `status`：`starting` / `listening` / `error`
- `bound`、`bindAddress`
- `sendTargets`
- `lastSendAt`、`lastReceiveAt`
- `currentError`（当前错误，成功收发后清除）
- `lastError`（最近历史错误）
- `peerCount`

该命令只返回本地发现诊断，不包含 token、requestSecret、文件名或路径。

**验收状态：** 用户已在两台真实 Windows 电脑上验证发现、主机批准和文件传输主流程通过。Public 硬门禁、网络切换恢复和最终安装包仍待本轮新构建的人工复核。