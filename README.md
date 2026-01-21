# AI Chat TOC (AI 对话目录)

<div align="center">
  <img src="icon.png" alt="Logo" width="128" height="128">
  <p>为 ChatGPT 和 Google Gemini 等 AI 对话页面添加右侧悬浮目录导航，支持 Markdown 导出。</p>
</div>

## ✨ 功能特性

- **📑 自动生成目录**：自动识别用户提问，在右侧生成悬浮目录，点击即可快速跳转。
- **🤖 多平台支持**：
  - [x] ChatGPT (chatgpt.com)
  - [x] Google Gemini (gemini.google.com)
- **📤 对话导出**：支持将完整对话导出为 Markdown 格式，自动区分 User 和 AI 角色，保留格式。
- **👀 智能交互**：
  - 自动跟随页面滚动高亮当前阅读位置。
  - 无对话内容时自动隐藏面板，不占用视野。
  - 目录面板高度动态自适应屏幕大小。
- **🎨 优雅设计**：
  - 深色模式适配。
  - 简洁的 SVG 图标。
  - 滚动条美化。

## 📦 安装说明

1. **下载代码**：
   - 克隆本仓库：`git clone https://github.com/pamler1004/AI-Chat-TOC.git`
   - 或者直接下载 ZIP 包并解压。

2. **加载扩展**：
   - 打开 Chrome 浏览器，访问 `chrome://extensions/`。
   - 打开右上角的 **"开发者模式" (Developer mode)** 开关。
   - 点击左上角的 **"加载已解压的扩展程序" (Load unpacked)**。
   - 选择本项目所在的文件夹（包含 `manifest.json` 的目录）。

3. **开始使用**：
   - 打开 ChatGPT 或 Gemini 页面，开始对话，右侧即会出现目录面板。

## 🛠️ 技术栈

- **Manifest V3**：符合最新的 Chrome 扩展标准。
- **原生 JavaScript**：无外部依赖，轻量高效。
- **MutationObserver**：实时监听 DOM 变化，动态更新目录。

## 📝 许可证

MIT License
