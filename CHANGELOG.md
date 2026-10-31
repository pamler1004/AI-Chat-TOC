# Changelog

AI Chat TOC 的所有显著变更记录。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),并遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.0.7] - 2026-10-31

### Fixed

- **ChatGPT 2026-10 前端重构导致目录 / 导出 / 跳转全面失效**:ChatGPT 匿名版与登录版相继切换到全新前端,移除了 `data-message-author-role`,扩展在对话页完全无输出。消息选择器升级为三代 DOM 多级回退:旧版(`data-message-author-role`)、2026-10 匿名态新版(`li[data-message-role]`,文本取 `[data-user-message-copy]` / `[data-assistant-markdown-root]`)、2026-10 登录态 app-shell 版(消息单元 `[data-content-search-unit-key]`,用户文本取 `[data-user-message-bubble]`),角色识别统一收敛到新增的 `getChatMsgRole()`。
- **新版界面「你说：/ChatGPT 说：」归属标签污染标题与导出**:新版在消息上方渲染归属标签,直接取容器文本会把标签混进目录标题和导出内容。改为优先从精确文本容器取文本,标题提取跳过单独成行的标签,`cleanChatText` 清洗带冒号变体。
- **滚动容器不再固定导致跳转兜底失效**:匿名新版改为整页滚动,登录态 app-shell 的滚动容器是内层 `.thread-scroll-container`(不再是 `main`)。新增 `getChatGPTScrollEl()` 从消息容器向上探测真正可滚动的元素,修复进入对话的全程扫描与点击目录项被移出 DOM 时的位置估算兜底。

## [1.0.6] - 2026-08-14

### Added

- **进入 ChatGPT 对话自动扫描补全目录**:ChatGPT 激进虚拟滚动只保留视口附近约 4 条消息,打开对话默认在底部时早期消息从没进过 DOM,导致目录缺项、必须手动滚到顶才能补全。新增 `scanWholeConversation()`,进入对话后程序化滚动经过全程、沿途缓存所有消息(连续 3 步无新增即自适应停止、回原位),目录打开即全;每个会话只扫一次。

### Fixed

- **ChatGPT 官方长对话目录在部分环境未被隐藏**:纯 CSS 隐藏规则在扩展未重载最新样式 / 旧版本 / ChatGPT 动态重建目录等场景下失效。新增 `hideOfficialToc()` JS 兜底,复用 `updateTOC` 的初始执行 + MutationObserver + 2s 兜底轮询三重触发,CSS + JS 双保险。

## [1.0.5] - 2026-07-31

### Fixed

- **浅色模式下展开目录面板文字看不清**:展开态背景近乎透明(`rgba(0,0,0,0.15)`),浅色页面上浅色文字无法辨认。改为强不透明深色底(`rgba(20,20,24,0.92)`),并加深投影与边框。
- **ChatGPT 虚拟滚动导致目录缺项**:ChatGPT 把视口外消息从 DOM 移除,刷新后目录只剩视口内条目。新增 sessionStorage 持久化(刷新即恢复全部历史),点击被移出 DOM 的条目时按目录顺序估算位置滚动、触发重渲染后重试。
- **会话切换时旧会话目录混入新会话**:原 stableId 碰撞检测在两条消息首行文本相同时(如"你好""继续")漏判。改用 URL pathname 变化检测会话切换,可靠清空缓存。

### Changed

- **隐藏 ChatGPT 官方目录**:ChatGPT 2026-06-08 推出长对话目录,位置与插件几乎重叠(官方 `right:16px` vs 插件 `right:20px`)。注入 CSS 隐藏(`div[class*="inset-e-4"][class*="top-1/2"][class*="translate-y-1/2"][class*="z-20"]`),避免视觉冲突。

## [1.0.4] - 2026-07-31

### Fixed

- **ChatGPT 单条消息时目录误显示**:observer 漏监听 `data-message-author-role` 属性变化(原本只监听 childList/characterData),导致 tocItems 卡在旧状态。新增 `attributeFilter` 监听该属性,并加 2 秒兜底轮询覆盖边缘情况。
- **隐藏的容器仍可 hover 展开**:内联 `display:none` 被自身 CSS `display:flex !important` 覆盖。改用 `.hidden` class 配合 CSS `display:none !important`(选择器 `#ai-toc-container.hidden` 特异性更高)。

## [1.0.3] - 2026-07-14

### Removed

- 「导出为图片」功能及 html2canvas 依赖:SPA 页面渲染不稳定,反复卡死/文字重叠。

### Changed

- 抽取 `getConversationGroups()` 统一列表渲染与 Markdown 导出的数据源。
- 包体从 77K 降到 29K。

## [1.0.2] - 2026-06-24

### Added

- 扩展文案与商店素材双语完善。
- 导出对话框 UI 样式加固,防宿主页面样式污染。

### Fixed

- 目录面板遮挡导出弹窗。
- Claude / Gemini 平台选择器抗改版。
- stableId 冲突导致目录错乱。

## [1.0.1] - 2026-06-23

小版本修复与元数据调整。

## [1.0.0] - 2026-06-20

首次发布。

### Added

- ChatGPT / Gemini / Claude 三平台 AI 对话目录导航。
- 右侧 hover 展开目录,点击锚点跳转到对应消息。
- 用户消息收藏(星标),支持只导出已收藏。
- Markdown 导出(全部 / 已收藏 / 筛选)。
- 固定目录面板(pin),常驻显示。
- 中英文 i18n。
