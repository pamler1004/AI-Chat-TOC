# TODO

> AI Chat TOC 项目待办清单
> 关于插件的迭代、优化、更新,以及 Chrome Web Store 相关事务。
>
> **图例**
> 🙋 = 需要你手动做(我做不了)
> 🤖 = 告诉我即可,我来做
> ⏳ = 等待中(无需主动做事,只需关注)

---

## 一、Chrome Web Store 商店事务

### 当前状态
- ✅ 1.0.0 已打包(`ai-chat-toc-1.0.0.zip`)
- ✅ 已提交审核(2026-06-20)
- ⏳ **等待审核结果**(通常几小时到 2-3 天)

### 短期(审核期)

- [ ] ⏳ 关注审核邮件,留意 Chrome Web Store 后台状态变化
- [ ] 🙋 **如果被拒**:把拒信原文(reason / 政策条款编号 / 审核员留言)截图/复制给我,我来分析并给出修改方案
- [ ] 🙋 **如果通过**:截一张商店页面截图存档,告诉我上线了

### 上线后立即做

- [ ] 🙋 把 GitHub 仓库改回 public(可选,不改也行,但开源能积累 stars/反馈)
  - 命令:`gh repo edit pamler1004/AI-Chat-TOC --visibility public --accept-visibility-change-consequences`
- [ ] 🤖 在 README.md 顶部加上 Chrome Web Store 徽章 + 安装链接(告诉我商店 URL 即可)
- [ ] 🙋 把商店页 URL 加到你的 leon-portfolio 作品集

### 隐私政策(可能被审核员要求补)

- [ ] 🤖 **如果审核员要 Privacy Policy URL**:告诉我一声,我写一份简短 HTML
  - 部署方案:GitHub Pages(开仓库的 Pages 功能即可,免费,几分钟搞定)
  - 内容已经在 manifest description 和详细说明里讲清楚了,只是要一个独立 URL 放着

---

## 二、迭代与优化

### 已知可优化项(来自之前的 code review,优先级排序)

- [ ] 🤖 **Claude 选择器二次降级**:`findClaudeContainer` 已有多级回退,但 `.font-claude-response-body`(AI 回复识别)仍是单点。Claude 改版概率最高的位置就是这里。可以加 `data-testid` / 属性兜底
- [ ] 🤖 **stableId 哈希冲突**:用户连续问两次"你好"会撞 ID,导致目录漏一条。可以加位置后缀(`-${index}`)
- [ ] 🤖 **流式输出期间目录滞后**:AI 回复的过程中目录不更新(防抖结束才更新)。可以改成"边输出边追加"的渐进式策略
- [ ] 🤖 **Gemini 选择器抗改版**:目前依赖 `.user-query-bubble-with-background` 等内部 class,Gemini 改版频率高,可以参照 Claude 的 `findClaudeContainer` 思路加多级回退
- [ ] 🤖 **死代码清理**:`styles.css` 还有上次"删图标 + 去 AI 锚点"留下的旧规则(`.ai-toc-item.ai` 缩进、`└` 符号),不影响功能但占空间

### 想到再加的功能(候选,不一定都做)

- [ ] 🤖 收藏列表单独视图(只看星标的提问)
- [ ] 🤖 目录搜索/过滤(对话很长时按关键词筛锚点)
- [ ] 🤖 自定义快捷键(打开/关闭面板、跳到上/下一个锚点)
- [ ] 🤖 暗色/亮色主题切换(目前是固定深色)
- [ ] 🤖 支持更多平台(Grok、DeepSeek、Kimi、豆包)
- [ ] 🤖 导出为 PDF / HTML
- [ ] 🤖 设置面板(原生 popup,而非全靠 manifest)

> 你只要说"做 X",我就动手。或者告诉我"这些我都不想做",我帮你删掉。

---

## 三、平台适配(防御性维护)

AI 平台 DOM 改版是**这类扩展的最大杀手**。下面是可能突然失效的征兆,按出现频率:

- [ ] ⏳ 哪天 Claude / Gemini / ChatGPT 上目录突然不出来或乱跳 → 告诉我"X 平台坏了",我接手诊断 + 修复
- [ ] ⏳ 商店收到差评说"在 X 网站不能用" → 截图差评原文给我

### 用户反馈监控

- [ ] 🙋 定期(每周一次?)看 Chrome Web Store 后台:
  - 用户评分 / 评论
  - 安装量 / 卸载量
- [ ] 🙋 用户提的 bug 或建议,转给我处理

---

## 四、版本发布流程(上线后每次更新都用)

> 修了 bug 或加了功能后,按这个流程发新版本

1. 🤖 我修代码,跑 `node --check content.js`
2. 🤖 我改 `manifest.json` 的 `version`(语义版本:bug 修复 1.0.x,小功能 1.x.0,大改 x.0.0)
3. 🤖 我重新打包 zip
4. 🤖 我 commit + push
5. 🙋 你登录 Web Store 后台,上传新 zip,提交审核
6. 🙋 等审核(通常比首次快,几小时内)

> 你只需要做第 5、6 步。前 4 步告诉我"打包 X.X.X"我就全做完。

---

## 五、长期事项

- [ ] 🙋 每年续费 Chrome 开发者账号(目前 $5 注册费是一次性,但要留意账号本身的活跃度)
- [ ] 🙋 备份这个项目到 OneDrive 之外(GitHub 已有,够了)
- [ ] 🤖 每隔几个月,跑一次代码审查(告诉我"再 review 一次",我会扫一遍当前代码,给出新的优化清单)

---

## 历史

- **2026-06-20** v1.0.0 首次提交 Chrome Web Store 审核
  - 涵盖功能:三平台目录(ChatGPT/Gemini/Claude)、收藏、Markdown 导出、图片导出、双语 UI
  - 同会话完成的稳定性优化:全链路 try-catch、Claude 选择器多级回退、renderTOC 改 stableId 匹配、observer 性能优化、XSS 防护
