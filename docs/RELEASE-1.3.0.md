# Filebridge-Lan 1.3.0

发布日期：2026-10-24

新增 **跨网络加密中继（实验）**。局域网模式不变。

## 新增

- 独立 Bridge Relay（`server/bridge.mjs`，默认 `:43000`）
  - 传输码、上传令牌、TTL、配额、简单限流
  - 只保存 AES-GCM 密文分片
  - 同时托管 `dist/`，手机打开公网链接即可接收
- 客户端跨网络面板
  - 发送：本地 AES-256-GCM 分片加密 → 上传 → 生成链接/二维码
  - 接收：从 `#receive=CODE&key=...` 链接自动填充 → 拉取密文 → 本地解密下载
  - 进度、速度、剩余时间、取消
- 公网中继地址可在 UI 中配置
- 全新 `docs/CROSS-NETWORK.md`：API、加密格式、Caddy 部署、安全模型

## 加密

- 32 字节随机 key，AES-256-GCM
- 4 MB 分片；12 字节 IV + 密文 + tag
- additionalData 绑定分片序号，防调换
- key 放在 URL fragment，不发送到中继

## 局域网保持

- HTTP Hub、SSE 上传进度、下载进度/取消、扫码进房间、自定义下载目录均保留
- 1.2.1 的 Windows 防火墙修复继续保留

## 验证

- 1 MB 文件浏览器 E2E：
  - 发送方加密上传 → 接收页自动查询 → 下载解密
  - 下载 SHA-256 与源文件完全一致
  - 中继磁盘分片为密文（明文 + 28 字节）
- `npm run test:bridge`：health / 创建 / 鉴权 / 分片 / 完成 / 查询 / 下载 / 删除
- `npm run test:hub`：11 项
- `npm run check`、`npm run build`、`cargo test` 通过
- `npm audit` 0

## 安装

安装包由 GitHub Actions 在 tag `v1.3.0` 上构建并上传，SHA-256 见 Release 资产 digest 和发布正文。

- 安装结束如出现 UAC，请允许一次（防火墙修复）
- 中继需要自行部署；安装包只包含客户端和本地 Hub

## 已知限制

- 跨网络接收端在内存中组装 Blob，超大文件受手机内存限制
- 中继无账号/按用户配额，默认单文件 2GB、总存储 8GB、TTL 24h
- 中继能看到文件名、大小、传输码、IP 和时间；内容为密文
- 无断点续传、分片并发、秒传、病毒扫描
- 中继必须部署在 HTTPS 后面；不要直接暴露 43000
- 安装包未签名，未构建 MSI

## 重新构建

```bash
npm install
npm run build
npm run test:bridge
npm run tauri build
```

中继：

```bash
BRIDGE_PUBLIC_URL=https://relay.example.com node server/bridge.mjs
```
