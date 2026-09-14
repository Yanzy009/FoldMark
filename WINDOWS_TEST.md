# Windows 实机验收

当前 Mac 可通过 GitHub Actions 验证 Windows 编译与安装包生成，但不能替代真实 WebView2 和资源管理器交互测试。

建议准备 Windows 10 与 Windows 11 干净虚拟机，各执行以下流程：

1. 安装 NSIS 版本，确认开始菜单、卸载入口和 FoldMark 图标；
2. 双击中文路径中的 `.md`，再用“打开方式”测试 `.markdown`；
3. 保持 FoldMark 运行，连续双击三份文件，确认只有一个窗口、三个标签；
4. 拖入文件，检查目录联动、表格、代码、Mermaid 和本地链接；
5. 用 GBK/GB18030 样例验证中文无乱码；
6. 安装更高版本覆盖升级，再卸载，确认用户文档不受影响；
7. 重复上述流程验证 MSI 包，并记录 Windows、WebView2 和安装包版本。

