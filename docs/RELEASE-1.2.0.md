# Filebridge-Lan 1.2.0

发布日期：2026-10-24

首个以 **Filebridge-Lan** 名称发布的开源版本（MIT）。功能与 1.1.3 一致，主要变化是品牌、应用身份和开源整理。

## 更名

- 项目名：`FileBridge` → **Filebridge-Lan**
- Windows 可执行文件：`filebridge-lan.exe`
- 安装目录：`%LOCALAPPDATA%\Filebridge-Lan`
- 应用标识：`com.filebridgelan.desktop`
- 数据目录：`Downloads\Filebridge-Lan`
- 环境变量：`FILEBRIDGE_LAN_*`（旧 `FILEBRIDGE_*` 不再使用）

> 新应用标识与旧版不同，会与旧 FileBridge 并存；建议安装后手动卸载旧版。首次启动会把 `Downloads\FileBridge` 迁移为 `Downloads\Filebridge-Lan`。

## 开源整理

- 新增 **MIT LICENSE**
- 新增 `SECURITY.md`、`CONTRIBUTING.md`、`THIRD_PARTY_NOTICES.md`
- 新增 Windows GitHub Actions CI
- 移除未使用的 `react-router-dom`，`npm audit` 0 漏洞
- 当前公开历史使用干净的单提交；旧开发历史已打包为本地归档 bundle，不随仓库发布

## 功能（延续 1.1.3）

- 手机扫码打开/进房间
- HTTP 大文件直传
- 桌面端下载进度、取消、`.part` 原子写入、同名去重
- 电脑端 SSE 实时接收进度
- Rust 内嵌 Hub（42080）与信令（42070）
- 自定义下载目录

## 下载

| 项目 | 值 |
|---|---|
| 安装包 | `Filebridge-Lan_1.2.0_x64-setup.exe` |
| 大小 | 5.0 MB |
| SHA-256 | `206fd21b312f4e9fc022ecfef2d0b759296f7a6ca1e8dbb3d3c2f6957e6fd572` |
| 平台 | Windows 10/11 x64 |
| 签名 | 未签名（SmartScreen 可能提示“未知发布者”） |

构建产物原始路径：`src-tauri/target/release/bundle/nsis/Filebridge-Lan_1.2.0_x64-setup.exe`。

## 验证记录

- 安装后 `filebridge-lan.exe` 版本 **1.2.0**
- `/api/info` 返回 `{"name":"Filebridge-Lan Hub","version":"1.2.0",...}`
- UI 标题/页脚为 **Filebridge-Lan**；首页显示“在线”和二维码
- 42070/42080 由同一个新进程监听
- 旧数据目录 `Downloads\FileBridge` 成功迁移到 `Downloads\Filebridge-Lan`，文件列表保留
- `npm run check`、`npm run build`、`npm run test:hub`（11 项）、`cargo check`、`cargo test`（2 项）通过
- `npm audit`：0 vulnerabilities
- GitHub Actions CI 文件已加入（首次推送后运行）

## 已知限制

- 未实现上传断点续传
- 没有鉴权/TLS；仅限可信局域网
- 安装包未签名，未构建 MSI
- 旧 FileBridge 安装不会被自动卸载（本次已在本机移除旧版）
- 公开仓库暂未放界面截图，避免带出旧品牌和内网信息

## 重新构建

```bash
npm install
npm run tauri build
```

产物：`src-tauri/target/release/bundle/nsis/Filebridge-Lan_<version>_x64-setup.exe`
