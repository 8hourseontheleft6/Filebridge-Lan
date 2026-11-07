# Filebridge-Lan 1.5.6 Preview 2

发布日期：待 CI Draft 图标与界面确认后确定

这是 `1.5.6` 的第二个 Preview，只包含品牌标识替换和图标资源更新；上传、断点续传、局域网发现、Public 门禁与 v1.5.6-preview.1 完全一致。

## 新标识

- 正式启用新的 Filebridge-Lan 标识：手写 `F` 与局域网信号弧组合，不再使用旧字母方块 `F`。
- 提供黑色透明版、白色透明版和白色圆角底板 App Icon，三者来自同一矢量母版。
- 黑色透明版用于浅色界面，白色透明版只用于深色区域，二者形状完全一致。
- App Icon 固定为白色底板 + 黑色标识，不提供蓝色变体。
- 标识本身不含任何文字，品牌名仍使用 Cambria 字标。

## 小尺寸优化

- 16 / 20 / 24px 额外增加约 5% 笔画重量，保证 `F` 在小尺寸不糊、不断。
- 16 / 20px 只保留一段信号弧和较小圆点，避免圆点变成墨块；32px 及以上恢复完整三段信号弧。
- 提供 16、20、24、32、40、48、64、128、256 共九档尺寸，全部从矢量母版重新渲染。

## 图标与系统集成

- 浏览器 favicon 改为白色底板 App Icon。
- Tauri 图标集（`32x32.png`、`128x128.png`、`128x128@2x.png`、`icon.png`、`icon.ico`）全部由新的 App Icon 生成。
- `icon.ico` 包含 16、20、24、32、40、48、64、128、256 九档帧。
- Windows 任务栏、开始菜单、窗口标题栏和 NSIS 安装器使用新的白色底板图标。

## 不变的约定

- 上传、Safari Fetch 分块、断点续传、局域网发现和 Public/Private 门禁行为不变。
- 品牌字标仍使用 Cambria；中文正文和功能控件仍使用 Microsoft YaHei，英文功能文本使用 Inter。
- 不改变已发布的 v1.5.5、v1.5.6-preview.1 tag 和资产。

## 验证状态

已通过：

- `npm run check`
- `npm run build`
- `npm run test:connection`
- `npm run test:version`
- `npm run test:hub`
- `npm run test:resume`
- `npm run test:offsets`
- `npm run test:bridge`
- `cargo test`
- `cargo check`
- 16–256px 接触表、浅色/深色背景、ICO 帧清单检查

仍待确认：

- 用户在真实安装包中确认图标、任务栏和安装器外观；
- 390px / 900px / 1440px 界面中标识的视觉比例；
- 之前的远端断联提示双机复测。
