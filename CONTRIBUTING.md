# Contributing

感谢参与 Filebridge-Lan。

## 开发环境

- Node.js ≥ 18
- Rust stable
- Windows 10/11（当前主要验证平台）

```bash
npm install
npm run check
npm run test:hub
cargo test --manifest-path src-tauri/Cargo.toml
```

## 提交前

请至少运行：

```bash
npm run check
npm run build
npm run test:hub
cargo test --manifest-path src-tauri/Cargo.toml
```

如果改动了 Tauri 配置、Rust 命令或安装包资源，请再运行：

```bash
npm run tauri build
```

## Pull Request

- 保持改动聚焦，说明动机、行为和验证方式
- 不提交 `release/`、`dist/`、`node_modules/`、`src-tauri/target/`
- 不提交真实密钥、个人路径、内网 IP 或用户文件
- UI 改动附截图；传输/安全相关改动附复现步骤
- 新依赖请确认许可证与现有 MIT 项目兼容

## 安全

不要用公开 Issue 报告可利用漏洞；见 [SECURITY.md](SECURITY.md)。

## 许可证

提交即表示你同意以 [MIT License](LICENSE) 授权你的贡献。
