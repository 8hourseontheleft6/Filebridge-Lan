# Filebridge-Lan 1.3.1

发布日期：2026-10-24

修复 WebRTC 房间一直停在“连接中”的问题；局域网 HTTP/跨网络中继保持不变。

## 根因

1. **WebView2 默认隐藏 host ICE 候选**  
   Tauri host 的 offer 只有 mDNS 候选：`xxxx.local:port`。  
   iPhone/Safari 和部分路由器无法解析 mDNS，ICE 一直 connecting。

2. **防火墙只放行 TCP**  
   1.3.0 安装器只添加 `-Protocol TCP`，WebRTC 需要的 UDP 没有明确放行。

3. **信令顺序**  
   Rust 信令原先先发 `peer_joined` 给 host，再发 `room_joined` 给 client；host 立即发 offer 时存在窗口。现在先让 client 收到 `room_joined`，再通知 host。

## 修复

- Tauri 启动时向 WebView2 追加：
  `--disable-features=WebRtcHideLocalIpsWithMdns`
  - 现在 host offer 使用局域网 IP 候选（验证为 `192.168.2.43`），不再只有 `.local`
- 安装器防火墙规则从 TCP 改为 **Any**（TCP/UDP），仍只限 Private/Domain
- 手动修复脚本 `scripts/fix-firewall.ps1` 同步改为 `-Protocol Any`
- Rust 信令调整 `room_joined` / `peer_joined` 顺序

## 验证

- Tauri WebView2 host + Chromium 手机页：ICE `checking → connected`，DataChannel 打开
- host 远端候选从 `xxx.local` 变为 `192.168.2.43`
- 1.3.0 同样场景只拿到 mDNS 候选，无法完成连接
- `npm run check` / `npm run build` / 1.3.1 NSIS 构建成功
- 实体 iPhone/Android 未在本机验证；修复针对 Safari 无法解析 mDNS 的已知问题

## 安装

安装包由 GitHub Actions 在 tag `v1.3.1` 上构建并上传，SHA-256 见 Release 资产 digest 和发布正文。

- 安装结束如出现 UAC，请允许一次（防火墙 Any 规则）
- 安装后版本应为 **1.3.1**
- 如果仍连接中：确认手机与电脑同一专用网络、关闭 AP 隔离、允许 UDP；大文件优先 HTTP

## 其他

- 跨网络加密中继仍是实验性功能，需要自行部署 HTTPS Relay
- 安装包未签名，未构建 MSI
