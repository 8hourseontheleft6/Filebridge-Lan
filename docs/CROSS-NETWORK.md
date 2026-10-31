# 跨网络加密中继（1.5.3，实验性）

> **状态：实验性，未完成真实 WAN 验证。**
>
> 已在 `127.0.0.1` / 同机浏览器验证加解密和分片；**没有**完成“手机蜂窝网络 + 电脑另一网络”的真实跨网测试。因此不能称为生产级公网中继。中继需要外部 HTTPS、反向代理和运维；当前没有正式账号体系。默认不启用，属于显式 opt-in。

## 1. 设计目标

- 手机/电脑不在同一局域网时，提供一个可选的自托管中继
- 中继只保存**密文**，不持有解密密钥
- 接收方打开链接即可用浏览器下载，无需安装 App
- 支持 TTL、配额、限流、并发上限，避免公开实例被无限占用
- 不替代局域网 HTTP；局域网模式不需要中继

## 2. 架构

```text
发送方（Tauri/网页）
  │  1. 本地生成 32B key；AES-GCM 分片加密
  │  2. HTTPS 分片上传密文
  ▼
Bridge Relay（Node，:43000，必须由 HTTPS 反向代理）
  ├─ 传输码 / 上传令牌 / 下载令牌 / TTL
  ├─ 密文分片磁盘目录
  └─ 托管 dist/ 接收页
  ▲
  │  3. 接收方打开 https://relay/#receive=CODE&key=...&token=...
  │  4. 拉取密文分片，本地解密
接收方（手机浏览器）
```

## 3. 加密与认证

- 每个文件生成随机 **32 字节 AES-256-GCM key**
- 文件按 **4 MB** 分片
- 每片：12 字节随机 IV + 密文 + 16 字节 tag；additionalData = `filebridge-relay-v1:<chunkIndex>`
- 上传格式：`IV || ciphertext || tag`
- 密钥、文件 SHA-256 和下载 token 放在链接 `#` 后：
  `https://relay.example.com/#receive=ABCDEFGH&key=<base64url>&token=<downloadToken>&hash=<sha256>`
- **fragment 不会出现在 HTTP 请求/Referer/服务器日志中**
- `uploadToken` 只给发送方；`downloadToken` 给接收方；缺少/错误 token 返回 401
- 元数据查询和分片下载都要求 downloadToken；传输码本身不是凭据
- 接收端校验最终文件大小与 SHA-256；校验失败不触发下载

## 4. 中继 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 版本、上限、TTL |
| POST | `/api/transfers` | 创建传输；公网实例需要 `Authorization: Bearer $BRIDGE_ACCESS_TOKEN` |
| PUT | `/api/transfers/:id/chunks/:index` | 上传密文分片，`X-Upload-Token` |
| POST | `/api/transfers/:id/complete` | 标记完成 |
| GET | `/api/transfers/code/:code` | 查询元数据，`X-Download-Token` 或 `?token=` |
| GET | `/api/transfers/:id/chunks/:index?code=&token=` | 下载密文分片 |
| DELETE | `/api/transfers/:id` | 删除，`X-Upload-Token` |

- 传输码 8 位，字符集去掉易混字符
- 默认单文件 2GB、总存储 8GB、TTL 24 小时
- 中继**不解密**，只校验分片大小/完成状态
- 分片完成时校验每片预期密文大小；接收端校验最终大小和 SHA-256
- 上传/下载有 IP + 全局限流，以及全局并发上限
- 存储配额在创建时原子预留，并发创建不会超卖

## 5. 本地开发

```bash
npm install
npm run build

# Linux/macOS
BRIDGE_PUBLIC_URL=http://127.0.0.1:43000 npm run bridge

# Windows PowerShell
$env:BRIDGE_PUBLIC_URL = 'http://127.0.0.1:43000'
npm run bridge
```

- 中继：`http://127.0.0.1:43000`（仅 loopback 允许 HTTP 开发）
- 打开中继地址即可看到跨网络面板
- 发送方填写 `http://127.0.0.1:43000`，上传后生成 `#receive=...&token=...` 链接
- 手机需要能访问该地址；**公网/手机接收必须用 HTTPS**（WebCrypto + 安全上下文）
- 非 loopback 直连 HTTP 会被拒绝（426）；本机开发以外的地址必须走 HTTPS 反代

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `BRIDGE_PORT` | `43000` | 监听端口 |
| `BRIDGE_HOST` | `0.0.0.0` | 监听地址 |
| `BRIDGE_DATA` | `./.filebridge-bridge` | 密文分片目录 |
| `BRIDGE_DIST` | `./dist` | 接收页静态文件 |
| `BRIDGE_PUBLIC_URL` | `http://localhost:<port>` | 公网 URL；非本地必须 HTTPS |
| `BRIDGE_MAX_BYTES` | `2147483648` | 单文件上限 |
| `BRIDGE_MAX_STORAGE` | `8589934592` | 总存储上限 |
| `BRIDGE_TTL_HOURS` | `24` | 传输有效期 |
| `BRIDGE_MAX_CONCURRENT` | `16` | 上传/下载并发上限 |
| `BRIDGE_ACCESS_TOKEN` | 空 | 公网实例必填；发送方创建传输的访问令牌 |
| `BRIDGE_ALLOW_ANONYMOUS` | `0` | 明确允许匿名公开创建；不建议 |
| `BRIDGE_TRUST_PROXY` | `0` | 是否信任反向代理的 `X-Forwarded-For/Proto` |
| `BRIDGE_TRUSTED_PROXIES` | loopback | 可信代理地址列表 |
| `BRIDGE_ALLOW_HTTP` | `0` | 仅本地开发允许非 HTTPS `BRIDGE_PUBLIC_URL`；不会放行公网直连 HTTP |

## 6. 公网部署（Caddy 反向代理）

1. 构建前端：`npm run build`
2. 启动中继（systemd / Windows 服务 / Docker 均可）：

```bash
BRIDGE_PORT=43000 \
BRIDGE_DATA=/var/lib/filebridge-bridge \
BRIDGE_DIST=/opt/filebridge/dist \
BRIDGE_PUBLIC_URL=https://relay.example.com \
BRIDGE_ACCESS_TOKEN='<long-random-secret>' \
BRIDGE_TRUST_PROXY=1 \
BRIDGE_TRUSTED_PROXIES=127.0.0.1,::1 \
node server/bridge.mjs
```

发送方在“跨网络传输”面板填写同一 `BRIDGE_ACCESS_TOKEN`；接收方不需要它，只需要链接里的 downloadToken 和解密 key。

3. Caddyfile：

```caddyfile
relay.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:43000
}
```

4. 只暴露 **443**，不要直接暴露 43000；`BRIDGE_PUBLIC_URL` 填 HTTPS 地址。

> 中继的 `/api` 允许 CORS；上传令牌在 `X-Upload-Token`，下载令牌在 `X-Download-Token` 或 `?token=`。
> 不要把中继和局域网 Hub 混在一起，也不要把 42080 暴露到公网。

## 7. 安全模型与限制

已做：

- AES-256-GCM 端到端加密（密钥不出浏览器 fragment）
- 公网实例必须有 `BRIDGE_ACCESS_TOKEN`（发送方访问），否则启动拒绝
- 上传令牌、下载令牌、元数据/分片下载鉴权
- 非 loopback 强制 HTTPS；可信代理解析真实客户端 IP
- IP + 全局限流；上传/下载并发上限
- 单文件/总存储配额、TTL 自动清理

未做 / 未验证：

- **真实 WAN 测试**（手机蜂窝网络 + 电脑另一网络）尚未完成；当前验证只覆盖同机和 localhost
- 中继可见文件名、大小、时间、传输码、IP 等元数据
- 无正式账号/登录/按用户配额/滥用举报流程
- 无断点续传、分片并发上传、秒传、病毒扫描
- 单机本地磁盘，无多区域/对象存储
- 接收端在内存组装 Blob，超大文件受手机内存限制

因此：**不要把它当作生产级公网服务运行**。公开运营前必须补账号/配额/滥用处理/隐私政策和监控。

## 8. 验证

```bash
npm run test:bridge
npm run test:hub
cargo test --manifest-path src-tauri/Cargo.toml
```

2026-10-24 已验证：

- 512 KB 文件：浏览器 AES-GCM 加密 → 中继分片上传 → 接收页下载解密；SHA-256 与源文件一致
- 中继磁盘上的分片为密文（明文 + 28 字节 IV/tag）
- 无 downloadToken 查询/下载 401；错误 token 401；删除后 404
- 无/错 accessToken 创建 401
- 非 loopback HTTP 启动被拒绝
- 并发配额预留只允许 1/10 成功
- 分片大小不符时 complete 返回 409
- 增量 SHA-256 测试通过；浏览器发送/接收 512 KB 文件下载 SHA-256 一致
- 错误 hash 时显示“文件不完整”，且不触发下载
- **未验证**：真实手机蜂窝网络 + 电脑另一网络；公网域名/证书/代理链
