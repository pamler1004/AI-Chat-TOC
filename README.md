# AI Chat TOC

<div align="center">
  <img src="src/icon.png" alt="Logo" width="128" height="128">

  <p><strong>AI 对话目录导航 · Side TOC navigation for AI chats</strong></p>
  <p>为 ChatGPT、Gemini、Claude 的长对话添加右侧悬浮目录,一键跳转到任意一条你的提问。</p>

  <a href="https://chromewebstore.google.com/detail/ai-chat-toc-ai-%E5%AF%B9%E8%AF%9D%E7%9B%AE%E5%BD%95%E5%AF%BC%E8%88%AA/ogjecajdbalhobcpigopjjpjkbhkeaak">
    <img src="https://img.shields.io/chrome-web-store/v/ogjecajdbalhobcpigopjjpjkbhkeaak.svg?label=Chrome%20Web%20Store&color=blue" alt="Chrome Web Store Version">
  </a>
  <img src="https://img.shields.io/chrome-web-store/users/ogjecajdbalhobcpigopjjpjkbhkeaak.svg?label=Users" alt="Chrome Web Store Users">
  <img src="https://img.shields.io/chrome-web-store/rating/ogjecajdbalhobcpigopjjpjkbhkeaak.svg?label=Rating" alt="Chrome Web Store Rating">
</div>

---

## ✨ 功能

- **📑 右侧悬浮目录** — 自动识别你的每一条提问并生成锚点,点击即跳转。至少 2 条提问时才出现,不打扰单轮对话。
- **⭐ 收藏关键提问** — 点击星标标记重要问题,收藏状态跨会话保留(浏览器本地存储)。
- **📝 Markdown 导出** — 支持单选 / 多选 / 全选 / 反选,Obsidian 友好,完整保留代码块、列表、加粗等格式。
- **🖼️ 图片导出** — 将对话渲染为排版精美的 PNG,导出前可预览。
- **📌 固定面板** — 长会话时一键固定常驻;默认 hover 展开、移开收起。
- **🌐 三平台一致体验** — ChatGPT / Gemini / Claude 统一的深色毛玻璃 UI。
- **🔒 100% 本地** — 无服务器、无埋点、无追踪,对话数据绝不离开浏览器。

## 🌐 支持平台

| 平台 | 域名 |
|------|------|
| ChatGPT | `chatgpt.com` |
| Google Gemini | `gemini.google.com` |
| Anthropic Claude | `claude.com` / `claude.ai` |

## 📦 安装

### 方式一:Chrome Web Store(推荐)

直接从商店安装,自动更新:
👉 [点击安装](https://chromewebstore.google.com/detail/ai-chat-toc-ai-%E5%AF%B9%E8%AF%9D%E7%9B%AE%E5%BD%95%E5%AF%BC%E8%88%AA/ogjecajdbalhobcpigopjjpjkbhkeaak)

### 方式二:开发者模式加载(立即体验)

1. 克隆仓库:`git clone https://github.com/pamler1004/AI-Chat-TOC.git`
2. 打开 `chrome://extensions/`,开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**,选择仓库下的 **`src/` 目录**(包含 `manifest.json`)
4. 打开任一支持的 AI 对话页,发 2 条以上提问,右侧即出现目录

> 💡 加载的是 `src/` 目录,**不是**项目根目录。

## 🛠️ 开发

本项目是**纯原生 JS、零依赖、无构建步骤**的 Manifest V3 扩展。

```
src/
├── manifest.json       # 扩展清单
├── content.js          # 全部逻辑(注入三平台)
├── styles.css          # 面板样式
├── icon.png            # 扩展图标
└── html2canvas.min.js  # 图片导出依赖(本地打包,非 CDN)
```

修改 `src/` 内任意文件后,到 `chrome://extensions/` 点该扩展的 **刷新** 按钮即可生效。

语法快速自检:

```bash
node --check src/content.js
```

## 📦 打包发布

```bash
# 1. 语法自检
node --check src/content.js

# 2. 从 src/ 压缩为 zip(zip 内顶层即 manifest.json,不能多套一层 src/ 目录)
cd src && zip -r ../dist/ai-chat-toc-1.0.0.zip . && cd ..

# 3. 更新 manifest.json 的 version 后重新打包,产物输出到 dist/
```

上传 `dist/ai-chat-toc-*.zip` 到 [Chrome Web Store 开发者后台](https://chrome.google.com/webstore/devconsole)。

## 📁 项目结构

```
ai-chat-toc/
├── src/                # 扩展源代码(Chrome 加载 / Store 上传内容)
├── dist/               # 打包产物(zip),不纳入版本管理
├── store/              # 商店素材(上架文案、截图等)
├── README.md           # 项目说明(本文件)
├── ROADMAP.md          # 维护路线图与定期检查清单
├── TODO.md             # 待办事项
└── .gitignore
```

## 🔒 隐私

本扩展**不收集、不存储、不上传**任何用户数据:

- 无 `fetch` / `XHR` / `WebSocket` 等任何网络请求(图片导出用的 html2canvas 也是本地打包)
- 仅请求三个 AI 对话域名的 host 权限,用于注入目录面板
- 不申请 `tabs` / `storage` / `cookies` / `history` 等任何其他权限
- 收藏状态通过浏览器 `localStorage` 保存,仅限本机

详见商店页「隐私实践」说明。

## 🛠️ 技术栈

- **Manifest V3** — 符合最新 Chrome 扩展标准
- **原生 JavaScript** — 零运行时依赖
- **MutationObserver** — 实时监听 DOM 变化,防抖 + 结构变化过滤
- **SPA 路由钩子** — 拦截 `pushState` / `replaceState` / `popstate`,适配 Claude 等单页应用
- **stableId DOM diff** — 用稳定哈希匹配而非索引,避免重渲染闪烁
- **XSS 防护** — 全链路 `escapeHtml` / `textContent`

## 📝 许可证

MIT License
