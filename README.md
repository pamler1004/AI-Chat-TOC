# AI Chat TOC (AI 对话目录) v1.5

<div align="center">
  <img src="icon.png" alt="Logo" width="128" height="128">

  <p>为 ChatGPT、Google Gemini 和 Claude 等 AI 对话页面添加右侧悬浮目录导航，支持 Markdown 导出和图片导出。</p>
</div>

## ✨ 功能特性

- **📑 自动生成目录**：自动识别用户提问和 AI 回复，在右侧生成悬浮目录，点击即可快速跳转。
- **🤖 多平台支持**：
  - [x] ChatGPT (chatgpt.com)
  - [x] Google Gemini (gemini.google.com)
  - [x] Anthropic Claude (claude.com, claude.ai)
- **📤 对话导出**：
  - **Markdown 导出**：选择导出对话，可单选、多选、全选或反选。
  - **图片导出**：一键导出对话为精美图片，适合分享和收藏。
  - **AI 回复预览**：选择对话框中显示每条对话的 AI 回复预览。
  - **Obsidian 适配**：优化的 Markdown 格式，完美支持代码块、列表、加粗等格式。
  - **完整内容**：自动收集 AI 回复的所有段落，避免内容丢失。
- **👀 智能交互**：
  - **自动收起/展开**：默认收起，鼠标悬停自动展开，不遮挡视线。
  - **固定模式**：支持一键固定目录面板，方便频繁操作。
  - **收藏功能**：点击左侧图标收藏重要条目，黄色星星标记，快速定位。
  - **滚动优化**：鼠标在目录上滚动时不影响页面滚动。
  - 自动跟随页面滚动高亮当前阅读位置。
  - 高度自适应屏幕，超过高度自动显示滚动条。
- **🎨 优雅设计**：
  - 深色模式适配，半透明毛玻璃效果。
  - 简洁的 SVG 图标。
  - 滚动条美化。
  - 统一的 UI 风格，跨平台一致。
  - 图片导出采用简约现代风格，适合技术内容和专业分享。

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
