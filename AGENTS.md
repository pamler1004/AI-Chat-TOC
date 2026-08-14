# AI Chat TOC — 项目规则

> 本文件是项目规则的**唯一权威源**;`CLAUDE.md` 是指向它的 symlink。
> Codex / Claude Code 等 agent 通过本文件了解项目约定。

## 项目定位

为 ChatGPT / Gemini / Claude 的长对话添加右侧悬浮目录(AI Chat TOC),支持锚点跳转、收藏重点提问、Markdown 导出。Manifest V3 扩展,已上线 Chrome Web Store。

## 核心约束(不可违背)

- **纯原生 JS、零依赖、无构建**:不引入 vite / webpack / plasmo 或任何打包器。`src/content.js` 是单文件,直接被 manifest 加载。
- **100% 本地**:无 fetch / XHR / WebSocket,不申请 tabs / storage / cookies 等额外权限。隐私是卖点,改动不得引入任何网络请求或新权限。

## 目录结构

```
ai-chat-toc/
├── AGENTS.md            # 本文件(规则源)
├── CLAUDE.md -> AGENTS.md
├── README.md            # 项目门面
├── CHANGELOG.md         # 已发生变更的【单一权威】(见「文档治理」)
├── LICENSE              # MIT
├── src/                 # 扩展源码(Chrome 加载 / Store 上传内容)
│   ├── manifest.json
│   ├── content.js       # 全部逻辑(注入三平台),单文件
│   ├── styles.css
│   ├── icon.png
│   └── _locales/{en,zh_CN}/messages.json
├── docs/                # 规划与待办(roadmap.md / todo.md / README.md)
├── scripts/package.mjs  # 打包发布脚本
├── store/store-listing.html  # 商店上架文案(带一键复制)
└── dist/                # 打包产物(.gitignore)
```

## 开发约定

- 改 `src/` 内任意文件后,到 `chrome://extensions/` 点扩展「刷新」生效。
- **语法自检**(改 content.js 后必跑):`node --check src/content.js`
- 平台 DOM 改版是这类扩展的最大杀手:选择器**优先多级回退,不硬依赖单一 class**;ChatGPT 长对话目录等已知冲突元素用 CSS + JS 双保险隐藏。

## 发版流程

1. 改代码 → `node --check src/content.js`
2. 改 `src/manifest.json` 的 `version`(语义版本:bug 修复 1.0.x,小功能 1.x.0)
3. **更新 `CHANGELOG.md`**(已发生变更的唯一记录位置)
4. 打包:`node scripts/package.mjs` → 生成 `dist/ai-chat-toc-{version}.zip`
5. commit + push
6. 人工:登录 [Web Store 后台](https://chrome.google.com/webstore/devconsole) 上传新 zip,提交审核

## 文档治理(防漂移)

- **`CHANGELOG.md` 是「已发生变更」的唯一权威**。每个版本改了什么只在这里记一次。
- `docs/roadmap.md`(方向+节奏)、`docs/todo.md`(具体待办)**不再重复记录版本历史**——只链接 CHANGELOG。
- 长期方向进 roadmap,操作步骤 / 检查清单进 todo,已发生的事实进 CHANGELOG。新增长文档放 `docs/` 下,并在 `docs/README.md` 登记。

## store 文案维护

- 商店文案在 `store/store-listing.html`(带一键复制按钮)。
- **文案必须与实际功能一致**:功能移除时(如 v1.0.3 移除图片导出)必须同步删文案,避免卖了已删功能。
