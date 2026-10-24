# 跨网络加密中继（1.3.0）

> 状态：实验性 MVP。局域网模式不需要中继；跨网络时使用独立的 Bridge Relay。

## 1. 设计目标

- 手机/电脑不在同一局域网，也能传文件
- 中继只保存**密文**，不持有解密密钥
- 接收方打开链接即可用浏览器下载，无需安装 App
- 中继可自托管，不绑定云厂商
- 支持 TTL、配额、限流，避免公开实例被无限占用

## 2. 架构

```text
发送方（Tauri/网页）
  │  1. 本地生成 32B key；AES-GCM 分片加密
  │  2. HTTPS 分片上传密文
  ▼
Bridge Relay（Node，:43000，背后 HTTPS）
  ├─ 传输码 / 上传令牌 / TTL
  ├─ 密文分片磁盘目录
  └─ 托管 dist/ 接收页
  ▲
  │  3. 接收方打开 https://relay/#receive=CODE&key=...
  │  4. 拉取密文分片，本地解密
接收方（手机浏览器）
```

## 3. 加密格式

- 每个文件生成随机 **32 字节 AES-256-GCM key**
- 文件按 **4 MB** 分片
- 每片：
  - 12 字节随机 IV
  - AES-GCM 密文 + 16 字节 tag
  - additionalData = `filebridge-relay-v1:<chunkIndex>`
- 上传格式：`IV || ciphertext || tag`
- 密钥编码为 base64url，放在链接 `#` 后：
  `https://relay.example.com/#receive=ABCDEFGH&key=<base64url>`
- **fragment 不会出现在 HTTP 请求/Referer/服务器日志中**

## 4. 中继 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 版本、上限、TTL |
| POST | `/api/transfers` | 创建传输，返回 id/code/uploadToken |
| PUT | `/api/transfers/:id/chunks/:index` | 上传密文分片，`X-Upload-Token` |
| POST | `/api/transfers/:id/complete` | 标记完成 |
| GET | `/api/transfers/code/:code` | 按传输码查询公开元数据 |
| GET | `/api/transfers/:id/chunks/:index?code=` | 下载密文分片 |
| DELETE | `/api/transfers/:id` | 删除，`X-Upload-Token` |

- `uploadToken` 只返回给发送方，不出现在公开查询中
- 传输码 8 位，字符集去掉了易混字符
- 默认单文件 2GB、总存储 8GB、TTL 24 小时
- 中继**不解密**，也无法校验明文内容；它只校验分片大小/完成状态

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

- 中继：`http://127.0.0.1:43000`
- 打开中继地址即可看到跨网络面板
- 发送方填写 `http://127.0.0.1:43000`，上传后生成 `#receive=...` 链接
- 手机需要能访问该地址；**公网/手机接收必须用 HTTPS**（WebCrypto + 安全上下文）

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `BRIDGE_PORT` | `43000` | 监听端口 |
| `BRIDGE_HOST` | `0.0.0.0` | 监听地址 |
| `BRIDGE_DATA` | `./.filebridge-bridge` | 密文分片目录 |
| `BRIDGE_DIST` | `./dist` | 接收页静态文件 |
| `BRIDGE_PUBLIC_URL` | `http://localhost:<port>` | 健康检查/展示用公网地址 |
| `BRIDGE_MAX_BYTES` | `2147483648` | 单文件上限 |
| `BRIDGE_MAX_STORAGE` | `8589934592` | 总存储上限 |
| `BRIDGE_TTL_HOURS` | `24` | 传输有效期 |

## 6. 公网部署（Caddy 反向代理）

1. 构建前端：`npm run build`
2. 启动中继（systemd / Windows 服务 / Docker 均可）：

```bash
BRIDGE_PORT=43000 \
BRIDGE_DATA=/var/lib/filebridge-bridge \
BRIDGE_DIST=/opt/filebridge/dist \
BRIDGE_PUBLIC_URL=https://relay.example.com \
node server/bridge.mjs
```

3. Caddyfile：

```caddyfile
relay.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:43000
}
```

4. 只暴露 **443**，不要直接暴露 43000；`BRIDGE_PUBLIC_URL` 填 HTTPS 地址。

> 中继的 `/api` 允许 CORS；上传令牌在 `X-Upload-Token`，接收码在查询参数。  
> 不要把中继和局域网 Hub 混在一起，也不要把 42080 暴露到公网。

## 7. 安全模型与限制

已做：

- AES-256-GCM 端到端加密（密钥不出浏览器 fragment）
- 上传令牌、查询/下载传输码、限流
- 单文件/总存储配额、TTL 自动清理
- HTTPS（部署层）和 CORS

未做：

- 账号/登录/按用户配额
- 文件名/大小/时间等元数据加密（中继可见）
- 断点续传、分片并发上传、秒传
- 病毒扫描、内容审核、滥用举报流程
- 多区域/对象存储（当前只支持本地磁盘）
- 接收端流式写盘（当前在内存组装 Blob，超大文件受手机内存限制）

如果公开运营，必须先补账号/配额/滥用处理/隐私政策和监控。

## 8. 验证

```bash
npm run test:bridge
npm run test:hub
cargo test --manifest-path src-tauri/Cargo.toml
```

2026-10-24 已验证：

- 1 MB 文件：浏览器 AES-GCM 加密 → 中继分片上传 → 接收页自动查询 → 下载解密；SHA-256 与源文件一致
- 中继磁盘上的分片为密文（比明文多 28 字节 IV+tag）
- 未授权上传 403、错误传输码 403、删除后 404
