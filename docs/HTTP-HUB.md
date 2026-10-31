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

- 首页默认“局域网直传”，可切换到“跨网络中继（实验）”
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
| GET | `/api/events?token=` | token | SSE 上传事件 |
| GET | `/api/files/:id?token=` | token | 下载；支持 `Range` |
| DELETE | `/api/files/:id` | token | 删除文件与元数据 |
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

### SSE

`text/event-stream`，事件名 `upload`：

```json
{ "id": "...", "name": "test.bin", "loaded": 1048576, "total": 10485760, "status": "progress" }
```

`status` 为 `started | progress | completed | failed`。

## 6. 安全

- 只用于可信局域网；HTTP 明文
- 不要把 42080 暴露到公网
- 配对码/token 不要发到公开群聊；二维码只在可信设备间传递
- 跨网络使用独立的加密中继，见 `CROSS-NETWORK.md`

## 7. 测试

```bash
npm run test:hub
```

覆盖：配对码、Host/Origin、配对 token、401、上传/SHA-256、下载、Range、空文件、文件名清洗、CORS、删除、轮换、配对限流。

## 8. 电脑互联（1.5.2）

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
{"app":"filebridge-lan","version":"1.5.2","id":"稳定实例ID","name":"DESKTOP-A","port":42080}
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