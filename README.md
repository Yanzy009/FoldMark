# FoldMark

轻量、专注、本地优先的 Markdown 阅读器。

FoldMark 面向“打开后安静阅读”这一件事：极简的方式，把表格、代码、Mermaid 流程图与长文档目录做成适合持续阅读的桌面体验。

## 功能

- CommonMark、GFM 表格、任务列表、删除线与安全链接；
- Mermaid 流程图缩放、适宽、拖动与大文件延迟渲染；
- 代码高亮与复制，表格独立滚动和全屏阅读；
- H1–H6 自动目录、正文联动与平滑气泡高亮；
- 多标签、文内搜索、阅读位置恢复、深浅主题和阅读偏好；
- 最近文档、文件夹文档库、Finder/资源管理器拖放；
- macOS / Windows 文件关联、双击打开和单实例文件转交；
- UTF-8、UTF-8 BOM、GBK/GB18030 中文文档；
- 同目录本地图片与 Markdown 链接的受限只读访问。

## 安全与隐私

文档只在当前设备解析。桌面端通过 Rust 命令和短期会话令牌访问用户明确打开的文件，不向网页渲染层暴露任意文件系统权限；原始 HTML 不执行，危险协议、远程图片、父目录穿越和符号链接逃逸会被阻止。

## 开发

需要 Node.js 22、Rust stable 和当前平台的 Tauri 2 系统依赖。

```bash
npm ci
npm run desktop:dev
```

完整检查：

```bash
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm audit --omit=dev
```

`fixtures/` 中保留两份可公开的人工回归文档：安全降级检查和外部保存自动刷新检查。

本机构建安装包：

```bash
npm run desktop:build
```

推送 `v*` 标签后，仓库中的 GitHub Actions 会同时生成支持 Apple Silicon 与 Intel 的 macOS Universal DMG，以及 Windows x64 NSIS 安装包。当前安装包未进行商业代码签名，首次打开时 macOS Gatekeeper 或 Windows SmartScreen 可能要求用户手动确认。

## 发布状态

当前公开版本为 `0.1.4`。macOS 与 Windows 安装包均由 GitHub Actions 在官方托管环境中从同一版本标签自动构建，便于用户下载，也便于维护者复现发行过程。安装与实机验收方法详见 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) 与 [WINDOWS_TEST.md](WINDOWS_TEST.md)。

## 项目边界

FoldMark 是纯阅读器。打印、PDF、自包含 HTML 导出和 Markdown 编辑不在当前路线中。

## License

MIT
