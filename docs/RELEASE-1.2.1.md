# Filebridge-Lan 1.2.1

发布日期：2026-10-24

修复安装版“电脑能打开、手机扫码/输入网址进不去”的防火墙问题。

## 根因

Windows 防火墙中存在针对 `filebridge-lan.exe` 的 **Block / Private** 入站规则（通常是首次运行时在防火墙提示中点了“不允许”，或系统自动阻止）。  
App 的 Rust Hub 实际监听正常：

- `0.0.0.0:42080` 可访问
- 本机 `http://127.0.0.1:42080/` 返回 200
- 手机被防火墙 Block 规则拦截

`npm run hub` 使用的是 `node.exe`，已有 Allow 规则，所以能访问。

## 修复

- NSIS 安装器新增 `NSIS_HOOK_POSTINSTALL`：安装结束时通过 UAC 请求一次管理员权限
  - 删除 `filebridge-lan.exe` 的旧 Block 规则
  - 删除旧的 `Filebridge-Lan` 规则
  - 添加 TCP 入站 Allow，仅限 **专用/域网络**
- 新增 `scripts/fix-firewall.ps1`：已安装 1.2.0 的用户可手动以管理员身份修复
- 设置面板增加防火墙提示

> 如果安装时拒绝了 UAC，手机仍会被防火墙拦截；请运行修复脚本或在 Windows 安全中心允许 `%LOCALAPPDATA%\Filebridge-Lan\filebridge-lan.exe`。

## 手动修复（当前已安装 1.2.0）

以管理员身份打开 PowerShell：

```powershell
cd <项目目录>
powershell -ExecutionPolicy Bypass -File .\scripts\fix-firewall.ps1
```

或直接执行：

```powershell
Get-NetFirewallRule -DisplayName 'filebridge-lan.exe' | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Filebridge-Lan' -Direction Inbound `
  -Program "$env:LOCALAPPDATA\Filebridge-Lan\filebridge-lan.exe" `
  -Action Allow -Protocol TCP -Profile Private,Domain
```

## 验证

- App 单独启动时 Hub 监听 `0.0.0.0:42080`
- 本机 `/` 返回 200，`/api/info` 返回 `1.2.1`
- 防火墙修复后手机可访问 `http://<电脑IP>:42080/`
- 安装包会请求一次 UAC；拒绝 UAC 时仍保留手动修复方式
- 现有下载/SSE/扫码功能不变

## 下载

安装包由 GitHub Actions 在 tag `v1.2.1` 上构建并上传；SHA-256 见 Release 页面和 GitHub 资产 digest。

## 已知限制

- 仅放行 **专用/域网络**；如果 WiFi 被 Windows 标记为“公用”，仍需手动改为“专用”
- 安装包未签名
- 路由器开启 AP 隔离时，手机与电脑无法互访

## 重新构建

```bash
npm install
npm run tauri build
```

产物：`src-tauri/target/release/bundle/nsis/Filebridge-Lan_1.2.1_x64-setup.exe`
