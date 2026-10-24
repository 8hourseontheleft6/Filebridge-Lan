# Filebridge-Lan HTTP Hub（MVP）

> 状态：Node + Rust 双实现；Rust 已内嵌 Tauri，含 Hub 与信令；支持手机扫码
> 端口：`42080`（Hub）/ `42070`（信令，两者不冲突）
> 代码：`server/hub.mjs`（Node）· `src-tauri/src/hub.rs`（Rust）· 前端：`src/http/HttpTransfer.tsx` · 冒烟测试：`scripts/hub-smoke.mjs` · 基准：`scripts/bench-upload.mjs`

## 1. 为什么是 HTTP

手机通过 `http://<局域网IP>` 访问时不是 secure context，`crypto.subtle`、`showSaveFilePicker`、Service Worker 都不可用；WebRTC 收到的字节在 JS 里没有可靠的流式落盘方式（原 StreamSaver 路径还有三处 API 误用，见 `docs/AUDIT.md` 的 D1）。

HTTP 方案利用浏览器原生能力：

- **上传**：`File` 直接作为 `POST` 请求体，浏览器从磁盘流式读取，JS 只拿进度事件；
- **下载**：普通 `<a href>`/导航，浏览器自己流式写磁盘；
- **电脑侧**：Node/Rust 都是流式写盘，内存不随文件大小增长。

这两条路径都不需要 secure context，也不需要外部 CDN。

## 2. 启动

```bash
npm run build   # 让 hub 能提供 dist/ 页面
npm run hub     # http://0.0.0.0:42080
```

或 `npm run dev:all`（Hub + 信令 + Vite）。

- 桌面：`http://localhost:5173`（Vite）或 `http://localhost:42080`（Hub 同源）
- 手机：`http://<电脑IP>:42080`
- 数据目录：`.filebridge-lan-data/`（可用 `FILEBRIDGE_LAN_HUB_DATA` 覆盖）

### Rust 版（Tauri 内嵌）

Tauri 启动时会自动在 `:42080` 拉起 Rust Hub；如果端口已被 Node Hub 占用，会复用外部 Hub。数据目录默认为系统下载目录下的 `Filebridge-Lan/`。

```bash
# 不启动 GUI，单独运行 Rust Hub / 信令验证（性能测试必须用 --release）
cargo run --release --manifest-path src-tauri/Cargo.toml --bin hub
cargo run --release --manifest-path src-tauri/Cargo.toml --bin signaling
# 可选环境变量：FILEBRIDGE_LAN_HUB_PORT / FILEBRIDGE_LAN_HUB_DATA / FILEBRIDGE_LAN_DIST / FILEBRIDGE_LAN_SIGNAL_PORT
```

Tauri 启动时会同时拉起 Rust Hub（42080）和 Rust 信令（42070）。Rust 版与 Node 版 API 契约一致。**性能测试必须用 release**：debug 构建的 SHA-256 未优化，1 GB 上传约 38 s；release 为 2.53 s。

## 3. API

所有响应带 CORS（`Access-Control-Allow-Origin: *`）；支持 `OPTIONS` 预检。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/info` | 设备名、版本、端口、局域网 IPv4 列表、文件数 |
| GET | `/api/files` | 文件元数据数组，按 `createdAt` 倒序 |
| POST | `/api/upload?name=<文件名>` | 请求体 = 文件原始字节；流式写盘 + SHA-256 |
| GET | `/api/events` | SSE 上传事件：`started/progress/completed/failed` |
| GET | `/api/files/:id` | 下载；支持 `Range: bytes=start-end` |
| DELETE | `/api/files/:id` | 删除文件与元数据 |
| GET | `/` | `dist/` 静态页面（SPA fallback） |

### 上传

```http
POST /api/upload?name=test.bin
Content-Type: application/octet-stream
Content-Length: 104857600

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

服务端行为：

1. 校验/清洗 `name`（去掉路径分隔符、控制字符、Windows 保留名，截断 200 字符）。
2. 写入 `.filebridge-lan-data/tmp/<uuid>.part`，同时更新 SHA-256。
3. `Content-Length` 存在时校验实际字节数。
4. 成功后原子 `rename` 到 `.filebridge-lan-data/files/<uuid>.bin`，写 `meta/<uuid>.json`。
5. 失败/中断删除 `.part`，不产生半成品。

### 下载

- `Content-Disposition: attachment; filename="..."; filename*=UTF-8''...`
- `Accept-Ranges: bytes`
- `Range` 命中返回 `206` + `Content-Range`；不合法返回 `416`
- 支持中文/emoji/空格文件名

### 事件流（SSE）

```http
GET /api/events
Accept: text/event-stream
```

```text
event: upload
data: {"id":"...","name":"video.mp4","loaded":52428800,"total":536870912,"status":"progress"}
```

`status`：

- `started`：收到上传请求，`loaded=0`
- `progress`：约每 200 ms 一条，带已收字节数
- `completed`：保存完成；客户端刷新 `/api/files`
- `failed`：中断、大小不符或写盘失败

桌面端 `HttpTransfer` 监听该事件，显示“正在接收”进度；页面关闭后不保留历史。

### 错误

| 状态码 | 场景 |
|---|---|
| 400 | 缺 `name`、上传字节数不符、非法路径 |
| 404 | 文件不存在 / 已删除 |
| 405 | 不支持的方法 |
| 416 | Range 不合法 |
| 500 | 写盘/元数据失败 |

## 4. 存储布局

```
.filebridge-lan-data/
├── files/<uuid>.bin       # 完成文件
├── meta/<uuid>.json       # id/name/size/sha256/mime/createdAt
└── tmp/<uuid>.part        # 上传中
```

启动时扫描 `meta/` 恢复文件索引；孤立/损坏元数据会被忽略。

## 5. 实测结果（2026-10-23，本机回环）

| 场景 | 结果 |
|---|---|
| 100 MB 上传 | 503 ms，SHA-256 一致 |
| 100 MB 下载 | 573 ms，SHA-256 一致 |
| Node 1 GB 上传（受控客户端） | 3.38 s / 303 MB/s，SHA-256 一致 |
| Node 1 GB 下载 | 2.32 s，SHA-256 一致 |
| Hub 内存（Node） | 上传前 84 MB → 上传后 60 MB → 下载后 73 MB（不随文件增长） |
| Rust release 256 MB 上传 | 606 ms / 422 MB/s，SHA-256 一致 |
| Rust release 1 GB 上传 | **2.53 s / 404 MB/s**，SHA-256 一致 |
| Rust release 1 GB 下载 | **1.54 s**，SHA-256 一致 |
| Rust 内存 | 约 9.4 MB（不随文件增长） |
| Rust debug 1 GB 上传 | 38.6 s（SHA-256 未优化，仅作对照，勿用于性能测试） |
| 空文件 | 201，size=0，SHA-256 = `e3b0c442...` |
| 中文/空格/# 文件名 | 名称与 `Content-Disposition` 正确 |
| `Range: bytes=0-1023` | 206，长度 1024 |
| CORS 预检 | 204，`Access-Control-Allow-Origin: *` |
| `../../evil.txt` | 清洗为 `evil.txt` |
| `CON.txt` | 清洗为 `_CON.txt` |
| 删除 | 204，随后 GET 404 |
| 手机 390 px 布局 | `scrollWidth=390`，文件行按钮右边界 352，无横向溢出 |
| 浏览器 XHR 上传 | CDP 驱动真实 file input 上传成功，列表出现新文件 |

> 回环数字不代表 WiFi 吞吐；真机 iPhone/Android 仍需按路线图 M1.0 做一次 2 GB 验证。
>
> 分段计时（release，1 GB）：读 body ≈ 0 ms、写盘 146 ms、SHA-256 701 ms、flush 0 ms；其余是网络/客户端耗时。debug 下 SHA-256 占约 37 s，这是之前“Rust 上传慢”的真正原因。

## 6. 当前限制

- **无鉴权**：任何能访问 42080 的局域网设备都能列出/上传/删除文件。
- **明文 HTTP**：没有 TLS；不要暴露到公网。
- **无上传续传**：下载支持 Range，上传中断会删除 `.part`，需要重传。
- **无实时进度推送**：上传方用 XHR 进度；桌面端靠 3 秒轮询文件列表，看不到“进行中”的字节进度。
- **debug 构建不适合性能测试**：SHA-256 未优化，1 GB 上传约 38 s；release 为 2.53 s。
- **无配额/大小上限**：上传大小只受磁盘限制。
- **MIME 信任客户端**：MIME 仅用于下载响应头，不影响落盘。

## 7. 扫码入口

- **首页二维码**：`http://<电脑IP>:<当前页面端口>/`，手机扫码直接打开传输页。
- **房间二维码**：创建 WebRTC 房间后生成 `http://<电脑IP>:<端口>/?room=<CODE>`。
- 手机端读取 `?room=` 后自动加入；首次失败会在 500 ms/1 s 后重试，最多 3 次，失败时首页显示错误和“重试加入”。
- 开发时页面在 Vite `:5173`，二维码也指向 `:5173`（避免打开旧 `dist`）；Tauri/生产页面在 `:42080`，二维码指向 `:42080`。
- 信令：浏览器开发用 `server/signaling.ts`（Node），Tauri 用 `src-tauri/src/signaling.rs`（Rust）。
- 房间码仅用于局域网配对，**没有鉴权**；不要暴露到公网。

## 8. 下一步

1. 上传会话 + `Content-Range` 续传（`.part` 持久化、页面刷新恢复）。
2. 访问 token / 6 位配对码 / 可选 PIN；Origin/Host 校验。
3. 配额、限流、磁盘空间检查、临时文件清理。
4. 浏览器 E2E（Playwright）：上传/下载/取消/断网/扫码/390px 布局。
5. Tauri 打包（单 exe）、托盘、自动更新。
