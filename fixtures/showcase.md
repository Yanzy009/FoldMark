# FoldMark · 轻量 Markdown 阅读器

> 专注阅读，本地优先。打开 Markdown，就能开始安静阅读。

## 一目了然的文档结构

FoldMark 会从 H1–H6 标题生成文档目录，随正文滚动平滑高亮当前章节。文件夹文档库、最近文件和文档目录都可以独立折叠。

| 特色 | 体验 |
|---|---|
| 纯阅读定位 | 没有编辑工具的视觉干扰 |
| 本地优先 | 文档只在当前设备解析 |
| 长文档友好 | 目录联动、阅读位置恢复与文内搜索 |
| 丰富内容 | GFM 表格、代码高亮与 Mermaid 图表 |

## Mermaid 流程图

```mermaid
flowchart LR
    A[打开 Markdown] --> B[安全本地解析]
    B --> C[目录与正文联动]
    C --> D[专注阅读]
```

FoldMark 为流程图提供缩放、适宽和拖动操作，复杂图表也能在有限窗口中舒适查看。

## 代码阅读

```ts
const experience = {
  focused: true,
  localFirst: true,
  distractions: 0,
}
```

## 安全与隐私

FoldMark 使用受限只读授权访问文档，阻止危险协议、远程图片、父目录穿越和符号链接逃逸。
