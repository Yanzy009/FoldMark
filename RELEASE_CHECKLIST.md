# FoldMark 发布验收清单

## 自动检查

- [ ] `npm ci && npm run check`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- [ ] GitHub Actions 的 macOS、Windows CI 全部通过
- [ ] 生产依赖审计无高危漏洞

## 功能验收

- [ ] Finder / Windows 资源管理器双击 `.md` 能启动 FoldMark 并打开文件
- [ ] “打开方式”可选择 FoldMark，且 `.markdown` 同样有效
- [ ] FoldMark 已运行时双击第二份文档，只复用当前实例并新建标签
- [ ] 中文、空格和特殊字符路径可打开；同一路径不产生重复标签
- [ ] 相对 Markdown 链接在新标签打开，越界路径被拒绝
- [ ] UTF-8、带 BOM 的 UTF-8、GBK/GB18030 中文均可阅读
- [ ] H1–H6 均进入目录；重名标题可分别跳转
- [ ] 大文件、表格、代码块、Mermaid、拖放与阅读位置恢复正常

## macOS 正式发行

- [ ] Apple Developer Program 已开通并创建 Developer ID Application 证书
- [ ] GitHub Secrets 已配置 Apple 证书与 App Store Connect API 凭据
- [ ] Universal DMG 同时包含 arm64 与 x86_64
- [ ] `codesign --verify --deep --strict FoldMark.app` 通过
- [ ] `spctl --assess --type execute --verbose FoldMark.app` 通过
- [ ] 公证完成并已 stapling；在一台未安装开发证书的新 Mac 上通过 Gatekeeper

## Windows 正式发行

- [ ] GitHub Actions 成功生成 NSIS `.exe` 安装包
- [ ] 在干净的 Windows 10、Windows 11 各安装一次
- [ ] WebView2 缺失时安装器能自动补齐；已有环境不重复干扰
- [ ] 中文排版、文件关联、Mermaid、拖放、升级和卸载通过
- [ ] 正式公开发布前完成 Windows 代码签名，SmartScreen 行为可接受

## GitHub 发布

- [ ] README 截图、功能说明、安装说明和隐私说明完成
- [ ] 版本号、Git tag、CHANGELOG 三者一致
- [ ] 推送 `v*` 标签后，Release 自动作为正式版本公开
- [ ] Release Assets 同时包含 macOS `universal.dmg` 和 Windows `x64-setup.exe`
- [ ] 从 README 顶部的两个下载按钮分别完成安装包下载
- [ ] 在新设备上复验安装、首次启动、文件关联与卸载
