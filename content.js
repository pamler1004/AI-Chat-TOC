/**
 * AI Chat TOC - Content Script
 * 负责解析页面内容并生成目录
 */

// 配置项
const CONFIG = {
  selectors: {
    chatgpt: {
      // 查找所有用户提问的容器
      // 策略：ChatGPT 的用户消息通常带有 data-message-author-role="user" 属性
      userMessage: '[data-message-author-role="user"]',
      // 备用选择器（如果属性找不到）
      // userMessageFallback: '.group.w-full:has(.whitespace-pre-wrap)',
      contentContainer: 'main', // 主要滚动区域
      scrollTarget: 'main .react-scroll-to-bottom--css-ikkyv-79elbk' // 或者是 html/body，视具体实现而定
    },
    gemini: {
      // Gemini 选择器
      userMessage: '.user-query-bubble-with-background .query-text',
      aiMessage: '.response-content .model-response-text',
      contentContainer: 'main'
    },
    claude: {
      // Claude 的用户消息选择器
      // 用户消息：.font-large 或 .font-user-message
      userMessage: '.font-large, .font-user-message',
      // AI 回复：.font-claude-response-body（每个段落都有这个类）
      aiMessage: '.font-claude-response-body',
      // 主容器包含所有对话（每个对话是独立的 DIV）
      contentContainer: '.flex-1.flex.flex-col.px-4.max-w-3xl.mx-auto.w-full.pt-1',
      scrollTarget: 'main'
    }
  },
  pollingInterval: 1000 // 轮询间隔（毫秒），用于 MutationObserver 之外的兜底
};

// 状态
let tocItems = [];
let currentPlatform = 'unknown';
// 从 localStorage 读取收藏状态，如果没有则初始化为空 Set
// 使用新的 stableId 格式（基于内容哈希），确保 DOM 重排后收藏状态不丢失
let bookmarkedItems; // 存储已收藏的项的 stableId
try {
  const raw = JSON.parse(localStorage.getItem('bookmarkedItems') || '[]');
  bookmarkedItems = new Set(Array.isArray(raw) ? raw : []);
} catch (e) {
  // localStorage 损坏时不致整个脚本启动失败
  bookmarkedItems = new Set();
}

// 上次渲染的数据签名，用于跳过无变化的 DOM 操作（防 hover 闪烁）
let lastRenderSignature = '';

// 初始化
function init() {
  detectPlatform();

  if (currentPlatform === 'claude') {
    // Claude 是单页应用（SPA）：首次加载可能落在首页。
    // 首页不显示目录（isClaudeConversationPage 返回 false），
    // 但从首页点进对话页时，SPA 路由不会重新加载本脚本，
    // 导致目录不出现（只有手动刷新页面才显示）。
    // 解决：在对话页立即初始化；并监听路由变化，进入对话页时自动补初始化。
    if (isClaudeConversationPage()) {
      setupClaude();
    }
    watchClaudeRoute();
    return;
  }

  // 其他平台正常初始化
  setTimeout(() => {
    createContainer();
    startObserving();
  }, 1000);
}

// Claude 初始化（创建容器 + 启动监听），幂等：容器已存在则跳过
function setupClaude() {
  if (document.getElementById('ai-toc-container')) return;
  // 延迟一点，确保对话 DOM 渲染完成
  setTimeout(() => {
    createContainer();
    startObserving();
  }, 1000);
}

// 监听 Claude SPA 路由变化，进入对话页时自动初始化目录
// 覆盖：首页 → 对话页、对话间切换、新对话发消息后 DOM 出现等场景
function watchClaudeRoute() {
  // 幂等守卫：history hook / 事件监听只安装一次，避免重复包装与监听器叠加
  if (window.__tocRouteHooked) return;
  window.__tocRouteHooked = true;

  let lastPath = window.location.pathname;

  const check = () => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
    }
    // 进入对话态（URL 或 DOM 判定）且尚未创建容器 → 补初始化
    if (!document.getElementById('ai-toc-container') && isClaudeConversationPage()) {
      setupClaude();
    }
  };

  // hook history API：SPA 路由的主要触发方式（低延迟响应）
  ['pushState', 'replaceState'].forEach((type) => {
    const orig = history[type];
    history[type] = function (...args) {
      const ret = orig.apply(this, args);
      setTimeout(check, 50);
      return ret;
    };
  });
  // 浏览器前进/后退
  window.addEventListener('popstate', () => setTimeout(check, 50));

  // 兜底轮询：覆盖少数不触发上述事件的导航，以及"URL 不变但 DOM 出现消息"（新对话）的场景
  setInterval(check, 1500);
}

// 查找 Claude 对话主容器（多级回退，应对改版导致的选择器失效）
function findClaudeContainer() {
  const candidates = [
    CONFIG.selectors.claude.contentContainer, // 原精确选择器优先
    'main [class*="max-w-3xl"]',
    'main [class*="max-w"]',
    '[class*="conversation"] [class*="max-w"]',
    'main' // 最终兜底
  ];
  for (const sel of candidates) {
    try {
      const el = document.querySelector(sel);
      // 必须包含多个子元素才视为对话容器（避免选到过宽但无内容的元素）
      if (el && el.children.length >= 2) return el;
    } catch (e) { /* 非法选择器，跳过 */ }
  }
  return null;
}

// 检查是否在 Claude 对话详情页
function isClaudeConversationPage() {
  // 方法1：检查 URL 路径
  // Claude 对话详情页的 URL 格式类似：https://claude.ai/chat/conv-xxxxx
  // 首页的 URL 是：https://claude.ai/ 或 https://claude.ai/chat
  const pathname = window.location.pathname;
  // 如果路径是 /chat 或 / 或空，说明是在首页
  if (pathname === '/' || pathname === '/chat' || pathname === '' || pathname.endsWith('/chat')) {
    return false;
  }
  // 如果路径包含 /chat/conv-，说明是在对话详情页
  if (pathname.includes('/chat/conv-') || pathname.includes('/chat/archive')) {
    return true;
  }
  // 方法2：检查页面上是否有对话容器作为兜底
  const mainContainer = findClaudeContainer();
  if (!mainContainer) {
    return false;
  }
  // 检查容器内是否有用户消息或 AI 回复
  const hasUserMessage = mainContainer.querySelector(CONFIG.selectors.claude.userMessage);
  const hasAiMessage = mainContainer.querySelector(CONFIG.selectors.claude.aiMessage);
  return hasUserMessage || hasAiMessage;
}

// 识别当前平台
function detectPlatform() {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com')) {
    currentPlatform = 'chatgpt';
  } else if (host.includes('gemini.google.com')) {
    currentPlatform = 'gemini';
  } else if (host.includes('claude.com') || host.includes('claude.ai')) {
    currentPlatform = 'claude';
  }
}

// 创建 UI 容器
function createContainer() {
  if (document.getElementById('ai-toc-container')) return;

  const container = document.createElement('div');
  container.id = 'ai-toc-container';

  const header = document.createElement('div');
  header.className = 'ai-toc-header';
  // 使用 SVG 图标替换原来的 emoji
  const downloadIcon = `
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
  `;

  const pinIcon = `
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="17" x2="12" y2="22"></line>
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
    </svg>
  `;

  header.innerHTML = `
    <span>Contents</span>
    <div class="ai-toc-controls">
      <span class="ai-toc-export" title="Export as Markdown / 导出为 Markdown">${downloadIcon}</span>
      <span class="ai-toc-pin" title="Pin / 固定">${pinIcon}</span>
    </div>
  `;

  // 导出功能 - 修改为先显示选择对话框
  header.querySelector('.ai-toc-export').onclick = showExportDialog;

  // 固定功能
  const pinBtn = header.querySelector('.ai-toc-pin');
  pinBtn.onclick = () => {
    container.classList.toggle('pinned');
    if (container.classList.contains('pinned')) {
      pinBtn.classList.add('active');
    } else {
      pinBtn.classList.remove('active');
    }
  };

  /* 已移除最小化功能
  header.querySelector('.ai-toc-toggle').onclick = () => {
    const list = container.querySelector('#ai-toc-list');
    if (list.style.display === 'none') {
      list.style.display = 'block';
    } else {
      list.style.display = 'none';
    }
  };
  */

  const list = document.createElement('div');
  list.id = 'ai-toc-list';

  container.appendChild(header);
  container.appendChild(list);
  document.body.appendChild(container);

  // 阻止滚动事件冒泡到页面，避免鼠标在目录上滚动时页面也滚动
  const preventWheelBubble = (e) => {
    e.stopPropagation();
  };

  list.addEventListener('wheel', preventWheelBubble, { passive: true });
}

// 开始监听 DOM 变化
function startObserving() {
  // 优先监听主内容区（范围更小、AI 流式输出时触发更少）；找不到才回退到 body
  const targetNode = document.querySelector('main') || document.body;
  const config = { childList: true, subtree: true };

  const callback = function (mutationsList) {
    // 只对结构变化（节点增删）触发防抖，忽略纯文本/属性变化，
    // 大幅减少 AI 流式输出（逐 token 更新）时的无效触发
    const hasStructural = mutationsList.some(
      m => m.addedNodes.length > 0 || m.removedNodes.length > 0
    );
    if (!hasStructural) return;
    if (window.__tocUpdateTimer) clearTimeout(window.__tocUpdateTimer);
    window.__tocUpdateTimer = setTimeout(updateTOC, 500);
  };

  const observer = new MutationObserver(callback);
  observer.observe(targetNode, config);

  // 初始执行一次
  setTimeout(updateTOC, 1000);
}

// 更新目录的核心逻辑
function updateTOC() {
  // 全链路安全包装：单条异常消息不应拖垮整个目录功能
  try {
    if (currentPlatform === 'chatgpt') {
      parseChatGPT();
    } else if (currentPlatform === 'gemini') {
      parseGemini();
    } else if (currentPlatform === 'claude') {
      parseClaude();
    }
    renderTOC();
  } catch (e) {
    console.error('[AI Chat TOC] updateTOC failed:', e);
  }
}

// 解析 ChatGPT 页面
function parseChatGPT() {
  const userSelector = CONFIG.selectors.chatgpt.userMessage;
  // AI 回复选择器 - 查找 assistant 角色的消息
  const aiSelector = '[data-message-author-role="assistant"]';

  // 获取所有消息（用户 + AI），按页面顺序排列
  const allElements = document.querySelectorAll(`${userSelector}, ${aiSelector}`);

  const newItems = [];

  // 先过滤掉嵌套元素，只保留顶层元素
  const topLevelElements = [];
  allElements.forEach(el => {
    if (el.offsetParent === null) return; // 跳过隐藏元素

    const isChild = topLevelElements.some(parent => parent.contains(el));
    if (!isChild) {
      // 如果是顶层元素，移除已经在这个列表中的子元素
      for (let i = topLevelElements.length - 1; i >= 0; i--) {
        if (el.contains(topLevelElements[i])) {
          topLevelElements.splice(i, 1);
        }
      }
      topLevelElements.push(el);
    }
  });

  topLevelElements.forEach((el, index) => {
    const isUser = el.getAttribute('data-message-author-role') === 'user';
    const isAi = el.getAttribute('data-message-author-role') === 'assistant';

    if (!isUser && !isAi) return;

    // 尝试获取文本内容
    const textDiv = el.innerText || el.textContent;
    let text = textDiv.trim();
    // 统一只取第一行作为标题
    const lines = text.split('\n');
    text = lines[0].trim();

    // 生成唯一 ID
    const stableId = `ai-toc-msg-${isUser ? 'user' : 'ai'}-${hashCode(text)}`;
    if (!el.id) {
      el.id = stableId;
    }

    if (text) {
      const newItem = {
        id: el.id,
        stableId: stableId,
        text: text,
        type: isUser ? 'user' : 'ai',
      };
      // 保留收藏状态 - 只对用户消息有效
      if (isUser && bookmarkedItems.has(stableId)) {
        newItem.bookmarked = true;
      }
      newItems.push(newItem);
    }
  });

  // 简单的 Diff 检查 - 使用 stableId 比较更可靠
  if (tocItems.length === newItems.length &&
      tocItems.every((item, i) =>
        item.stableId === newItems[i].stableId &&
        item.type === newItems[i].type &&
        item.text === newItems[i].text)) {
    // console.log('[AI Chat TOC] No changes detected');
    return;
  }

  // console.log('[AI Chat TOC] Updating TOC:', newItems.length, 'items');
  tocItems = newItems;
}

// 简单的字符串哈希函数，用于生成稳定的 ID
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36); // 转换为字母数字混合的字符串
}

// 解析 Gemini 页面
function parseGemini() {
  // Gemini 的选择器
  const userSelector = CONFIG.selectors.gemini.userMessage;
  const aiSelector = CONFIG.selectors.gemini.aiMessage;

  // 获取所有消息（用户 + AI），按页面顺序排列
  const allElements = document.querySelectorAll(`${userSelector}, ${aiSelector}`);

  const newItems = [];

  // 先过滤掉嵌套元素，只保留顶层元素
  const topLevelElements = [];
  allElements.forEach(el => {
    if (el.offsetParent === null) return; // 跳过隐藏元素

    const isChild = topLevelElements.some(parent => parent.contains(el));
    if (!isChild) {
      // 如果是顶层元素，移除已经在这个列表中的子元素
      for (let i = topLevelElements.length - 1; i >= 0; i--) {
        if (el.contains(topLevelElements[i])) {
          topLevelElements.splice(i, 1);
        }
      }
      topLevelElements.push(el);
    }
  });

  topLevelElements.forEach((el) => {
    const isUser = el.classList.contains('query-text');
    const isAi = el.classList.contains('model-response-text') || el.tagName === 'STRUCTURED-CONTENT-CONTAINER';

    if (!isUser && !isAi) return;

    // 尝试获取文本内容
    let textDiv = el.innerText || el.textContent;
    // 移除用户消息前面的"你说 "前缀
    if (isUser) {
      textDiv = textDiv.replace(/^你说\s*/, '').trim();
    }
    // 统一只取第一行作为标题
    const lines = textDiv.trim().split('\n');
    const text = lines[0].trim();

    // 生成唯一 ID
    const stableId = `ai-toc-msg-gemini-${isUser ? 'user' : 'ai'}-${hashCode(text)}`;
    if (!el.id) {
      el.id = stableId;
    }

    if (text) {
      const newItem = {
        id: el.id,
        stableId: stableId,
        text: text,
        type: isUser ? 'user' : 'ai',
      };
      // 保留收藏状态 - 只对用户消息有效
      if (isUser && bookmarkedItems.has(stableId)) {
        newItem.bookmarked = true;
      }
      newItems.push(newItem);
    }
  });

  // 简单的 Diff 检查 - 使用 stableId 比较更可靠
  if (tocItems.length === newItems.length &&
      tocItems.every((item, i) =>
        item.stableId === newItems[i].stableId &&
        item.type === newItems[i].type &&
        item.text === newItems[i].text)) {
    // console.log('[AI Chat TOC] No changes detected');
    return;
  }

  // console.log('[AI Chat TOC] Updating TOC:', newItems.length, 'items');
  tocItems = newItems;
}

// 解析 Claude 页面
function parseClaude() {
  // Claude 的结构：主容器包含所有对话，每个对话是独立的 DIV
  // 用户消息：有 .font-large 类
  // AI 回复：有 .font-claude-response-body 类（但每个段落都有这个类，所以需要找到第一个段落）
  const mainContainer = findClaudeContainer();

  if (!mainContainer) {
    return;
  }

  const allElements = [];

  // 获取主容器的所有直接子元素
  const children = Array.from(mainContainer.children);

  // console.log('[Claude] Found children:', children.length);

  // 用于跟踪已处理的 AI 回复容器
  const processedAiContainers = new Set();

  children.forEach(child => {
    if (child.offsetParent === null) return; // 跳过隐藏元素

    // 检查是否是用户消息
    const userMsg = child.querySelector(CONFIG.selectors.claude.userMessage);
    if (userMsg) {
      let userText = userMsg.textContent.trim();
      // 只取第一行作为标题
      const lines = userText.split('\n');
      userText = lines[0].trim();
      if (userText) {
        const stableId = `ai-toc-msg-claude-user-${hashCode(userText)}`;
        if (!userMsg.id) {
          userMsg.id = stableId;
        }
        allElements.push({
          el: userMsg,
          type: 'user',
          text: userText
        });
      }
    }

    // 检查是否是 AI 回复 - 查找包含 .font-claude-response-body 但不是该类的元素
    // AI 回复容器通常包含多个 .font-claude-response-body 段落
    const aiParagraphs = child.querySelectorAll('.font-claude-response-body');
    if (aiParagraphs.length > 0 && !userMsg) {
      // 这是一个 AI 回复容器
      // 检查是否已经处理过这个容器（通过第一个段落的引用）
      const firstParagraph = aiParagraphs[0];
      const containerKey = firstParagraph.textContent?.trim().substring(0, 50);

      if (!processedAiContainers.has(containerKey)) {
        processedAiContainers.add(containerKey);

        // 取第一段的文本作为标题
        let aiText = '';
        aiParagraphs.forEach(p => {
          const text = p.textContent.trim();
          if (text && text.length > 5 && !aiText) {
            aiText = text; // 取第一段作为标题
          }
        });

        // 只取第一行作为标题
        let displayText = aiText;
        const aiLines = displayText.split('\n');
        if (aiLines.length > 1) {
          displayText = aiLines[0].trim();
        }

        if (displayText && displayText.length > 10) {
          const stableId = `ai-toc-msg-claude-ai-${hashCode(displayText)}`;
          if (!firstParagraph.id) {
            firstParagraph.id = stableId;
          }
          allElements.push({
            el: firstParagraph,
            type: 'ai',
            text: displayText
          });
        }
      }
    }
  });

  // console.log('[Claude] Final elements:', allElements.length, 'User:', allElements.filter(e => e.type === 'user').length, 'AI:', allElements.filter(e => e.type === 'ai').length);

  const newItems = [];
  allElements.forEach(({ el, type, text }) => {
    // 生成唯一 ID
    const stableId = `ai-toc-msg-claude-${type}-${hashCode(text)}`;
    if (!el.id) {
      el.id = stableId;
    }

    if (text) {
      const newItem = {
        id: el.id,
        stableId: stableId,
        text: text,
        type: type,
      };
      // 保留收藏状态 - 只对用户消息有效
      if (type === 'user' && bookmarkedItems.has(stableId)) {
        newItem.bookmarked = true;
      }
      newItems.push(newItem);
    }
  });

  // 简单的 Diff 检查 - 使用 stableId 比较更可靠
  if (tocItems.length === newItems.length &&
      tocItems.every((item, i) =>
        item.stableId === newItems[i].stableId &&
        item.type === newItems[i].type &&
        item.text === newItems[i].text)) {
    // console.log('[AI Chat TOC] No changes detected');
    return;
  }

  // console.log('[AI Chat TOC] Updating TOC:', newItems.length, 'items');
  tocItems = newItems;
}

// 导出为 Markdown
function exportToMarkdown(selectedItems = null) {
  let markdownContent = '';

  // 添加标题
  const title = document.title || 'AI Chat Export';
  markdownContent += `# ${title}\n\n`;
  markdownContent += `> Export time: / 导出时间：${new Date().toLocaleString()}\n\n---\n\n`;

  if (currentPlatform === 'chatgpt') {
    markdownContent += extractChatGPTContent(selectedItems);
  } else if (currentPlatform === 'gemini') {
    markdownContent += extractGeminiContent(selectedItems);
  } else if (currentPlatform === 'claude') {
    markdownContent += extractClaudeContent(selectedItems);
  } else {
    markdownContent += '> Cannot identify the current platform, export failed. / 无法识别当前平台，导出失败。\n';
  }

  downloadFile(markdownContent, `chat-export-${new Date().toISOString().slice(0,10)}.md`);

  // 导出后清理对话框
  const existingDialog = document.getElementById('ai-toc-export-dialog');
  if (existingDialog) {
    existingDialog.remove();
  }
}

// 显示导出选择对话框
function showExportDialog() {
  // 如果已存在对话框，先移除
  const existingDialog = document.getElementById('ai-toc-export-dialog');
  if (existingDialog) {
    existingDialog.remove();
  }

  // 创建对话框容器
  const dialog = document.createElement('div');
  dialog.id = 'ai-toc-export-dialog';

  // 使用当前的 tocItems 生成选项
  const conversations = tocItems.map((item, index) => ({
    index,
    id: item.stableId,
    text: item.text,
    type: item.type,
    elementId: item.id
  }));

  // 构建对话列表（按用户提问分组）
  const conversationGroups = [];
  let currentGroup = null;

  conversations.forEach(conv => {
    if (conv.type === 'user') {
      currentGroup = { user: conv, aiReplies: [] };
      conversationGroups.push(currentGroup);
    } else if (currentGroup) {
      currentGroup.aiReplies.push(conv);
    }
  });

  // 生成对话框 HTML
  let itemsHtml = '';
  const aiLabel = getAILabel();
  conversationGroups.forEach((group, groupIndex) => {
    const userText = group.user.text.substring(0, 80) + (group.user.text.length > 80 ? '...' : '');
    const aiCount = group.aiReplies.length;
    // 获取第一条 AI 回复的前 60 个字符作为预览
    const aiPreview = aiCount > 0
      ? group.aiReplies[0].text.substring(0, 60) + (group.aiReplies[0].text.length > 60 ? '...' : '')
      : 'No reply / 暂无回复';
    itemsHtml += `
      <div class="export-item" data-group-index="${groupIndex}">
        <label class="export-item-label">
          <input type="checkbox" class="export-checkbox" data-group-index="${groupIndex}" checked>
          <div class="export-item-content">
            <div class="export-item-user">🙋 ${escapeHtml(userText)}</div>
            <div class="export-item-ai">🤖 ${aiLabel} Reply / 回复 × ${aiCount} · ${escapeHtml(aiPreview)}</div>
          </div>
        </label>
      </div>
    `;
  });

  dialog.innerHTML = `
    <div class="export-dialog-content">
      <div class="export-dialog-header">
        <h3>Select Conversations to Export / 选择要导出的对话</h3>
        <div class="export-controls">
          <button id="export-select-all" class="export-btn">Select All / 全选</button>
          <button id="export-select-none" class="export-btn">Deselect All / 取消全选</button>
          <button id="export-select-inverse" class="export-btn">Invert / 反选</button>
        </div>
      </div>
      <div class="export-items-container">
        ${itemsHtml}
      </div>
      <div class="export-dialog-footer">
        <span class="export-count">Selected / 已选择：<span id="export-selected-count">${conversationGroups.length}</span> / ${conversationGroups.length}</span>
        <div class="export-actions">
          <button id="export-cancel" class="export-btn export-btn-secondary">Cancel / 取消</button>
          <button id="export-preview" class="export-btn export-btn-secondary">Preview / 预览</button>
          <button id="export-image" class="export-btn export-btn-secondary">Export as Image / 导出为图片</button>
          <button id="export-confirm" class="export-btn export-btn-primary">Export Selected / 导出所选</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  // 绑定事件
  const selectAllBtn = dialog.querySelector('#export-select-all');
  const selectNoneBtn = dialog.querySelector('#export-select-none');
  const selectInverseBtn = dialog.querySelector('#export-select-inverse');
  const cancelBtn = dialog.querySelector('#export-cancel');
  const confirmBtn = dialog.querySelector('#export-confirm');
  const exportImageBtn = dialog.querySelector('#export-image');
  const previewBtn = dialog.querySelector('#export-preview');
  const checkboxes = dialog.querySelectorAll('.export-checkbox');
  const selectedCountEl = dialog.querySelector('#export-selected-count');

  // 全选
  selectAllBtn.onclick = () => {
    checkboxes.forEach(cb => cb.checked = true);
    updateSelectedCount();
  };

  // 取消全选
  selectNoneBtn.onclick = () => {
    checkboxes.forEach(cb => cb.checked = false);
    updateSelectedCount();
  };

  // 反选
  selectInverseBtn.onclick = () => {
    checkboxes.forEach(cb => cb.checked = !cb.checked);
    updateSelectedCount();
  };

  // 取消
  cancelBtn.onclick = () => {
    dialog.remove();
  };

  // 收集当前勾选的对话组索引（预览/导出Markdown/导出图片共用）
  const getSelectedIndices = () => {
    const indices = [];
    checkboxes.forEach((cb, index) => {
      if (cb.checked) indices.push(index);
    });
    return indices;
  };

  // 预览
  previewBtn.onclick = () => {
    showImagePreview(getSelectedIndices(), conversationGroups);
  };

  // 确认导出 Markdown
  confirmBtn.onclick = () => {
    const selectedIndices = getSelectedIndices();

    if (selectedIndices.length === 0) {
      alert('Please select at least one conversation / 请至少选择一个对话');
      return;
    }

    if (selectedIndices.length === conversationGroups.length) {
      // 全选，直接导出所有
      exportToMarkdown();
    } else {
      // 导出选中的
      exportToMarkdown(selectedIndices);
    }
  };

  // 导出为图片
  exportImageBtn.onclick = () => {
    const selectedIndices = getSelectedIndices();

    if (selectedIndices.length === 0) {
      alert('Please select at least one conversation / 请至少选择一个对话');
      return;
    }

    // 关闭对话框，然后导出
    dialog.remove();
    exportToImage(selectedIndices, conversationGroups);
  };

  // 单个复选框变化
  checkboxes.forEach(cb => {
    cb.onchange = updateSelectedCount;
  });

  // 更新选中数量
  function updateSelectedCount() {
    const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
    selectedCountEl.textContent = checkedCount;
  }
}

// HTML 转义函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 根据平台获取 AI 回复标签
function getAILabel() {
  switch (currentPlatform) {
    case 'chatgpt':
      return 'ChatGPT';
    case 'gemini':
      return 'Gemini';
    case 'claude':
      return 'Claude';
    default:
      return 'AI';
  }
}

// 提取 ChatGPT 内容 (问答对)
function extractChatGPTContent(selectedIndices = null) {
  let md = '';
  // 策略：不再依赖 article，直接查找所有消息元素
  const messages = document.querySelectorAll('[data-message-author-role]');

  if (messages.length > 0) {
    // 按对话分组（用户消息 + 后续 AI 回复）
    const conversationGroups = [];
    let currentGroup = null;

    messages.forEach(msg => {
      const role = msg.getAttribute('data-message-author-role');
      let text = msg.innerText || msg.textContent;
      text = cleanChatText(text);

      if (!text.trim()) return;

      if (role === 'user') {
        currentGroup = { user: { text }, aiReplies: [] };
        conversationGroups.push(currentGroup);
      } else if (currentGroup) {
        currentGroup.aiReplies.push(text);
      }
    });

    // 根据选中的索引导出
    conversationGroups.forEach((group, index) => {
      if (selectedIndices !== null && !selectedIndices.includes(index)) return;

      md += `## 🙋 ${group.user.text}\n\n`;
      group.aiReplies.forEach(aiText => {
        md += `**🤖 ${getAILabel()} Reply / 回复**:\n\n${formatForMarkdown(aiText)}\n\n`;
        md += `---\n\n`;
      });
    });
  } else {
    // 兜底策略：使用之前的选择器
    md += '> ⚠️ Could not extract conversation structure precisely, only TOC items exported. / 无法精确提取对话结构，仅导出目录项。\n\n';
    tocItems.forEach(item => {
       md += `## Question\n\n${item.text}\n\n`;
    });
  }

  return md;
}

// 提取 Gemini 内容
function extractGeminiContent(selectedIndices = null) {
  let md = '';

  const userSelector = CONFIG.selectors.gemini.userMessage;
  const aiSelector = CONFIG.selectors.gemini.aiMessage;

  // 获取所有消息（用户 + AI），按页面顺序排列
  const allElements = document.querySelectorAll(`${userSelector}, ${aiSelector}`);

  // 过滤掉嵌套元素
  const topLevelElements = [];
  allElements.forEach(el => {
    if (el.offsetParent === null) return;

    const isChild = topLevelElements.some(parent => parent.contains(el));
    if (!isChild) {
      for (let i = topLevelElements.length - 1; i >= 0; i--) {
        if (el.contains(topLevelElements[i])) {
          topLevelElements.splice(i, 1);
        }
      }
      topLevelElements.push(el);
    }
  });

  // 按对话分组
  const conversationGroups = [];
  let currentGroup = null;

  const recentTexts = []; // 用于连续文本去重

  topLevelElements.forEach(el => {
    const isUser = el.classList.contains('query-text');
    const isAi = el.classList.contains('model-response-text') || el.tagName === 'STRUCTURED-CONTENT-CONTAINER';

    if (!isUser && !isAi) return;

    let text = el.innerText || el.textContent;
    if (isUser) {
      text = text.replace(/^你说\s*/, '').trim();
    }
    text = cleanChatText(text);

    if (!text.trim()) return;

    // 文本去重：规范化后比较
    const normalizedText = text.trim().replace(/\s+/g, ' ');
    if (recentTexts.includes(normalizedText)) return;

    recentTexts.push(normalizedText);
    if (recentTexts.length > 5) recentTexts.shift();

    if (isUser) {
      currentGroup = { user: { text }, aiReplies: [] };
      conversationGroups.push(currentGroup);
    } else if (currentGroup) {
      currentGroup.aiReplies.push(text);
    }
  });

  // 根据选中的索引导出
  conversationGroups.forEach((group, index) => {
    if (selectedIndices !== null && !selectedIndices.includes(index)) return;

    md += `## 🙋 ${group.user.text}\n\n`;
    group.aiReplies.forEach(aiText => {
      md += `**🤖 ${getAILabel()} Reply / 回复**:\n\n${formatForMarkdown(aiText)}\n\n`;
      md += `---\n\n`;
    });
  });

  if (conversationGroups.length === 0) {
    md += '> ⚠️ Failed to extract Gemini conversation content, selectors may be outdated. / 无法提取 Gemini 对话内容，可能选择器已失效。\n';
  }

  return md;
}

// 提取 Claude 内容
function extractClaudeContent(selectedIndices = null) {
  let md = '';

  const mainContainer = findClaudeContainer();

  if (!mainContainer) {
    md += '> ⚠️ Failed to extract Claude conversation content, main container not found. / 无法提取 Claude 对话内容，主容器未找到。\n';
    return md;
  }

  const children = Array.from(mainContainer.children);
  const recentTexts = [];
  const processedAiContainers = new Set();

  // 按对话分组
  const conversationGroups = [];
  let currentGroup = null;

  children.forEach(child => {
    if (child.offsetParent === null) return;

    const userMsg = child.querySelector(CONFIG.selectors.claude.userMessage);

    if (userMsg) {
      let text = userMsg.textContent.trim();
      text = cleanChatText(text);

      if (!text.trim()) return;

      const normalizedText = text.trim().replace(/\s+/g, ' ');
      if (recentTexts.includes(normalizedText)) return;
      recentTexts.push(normalizedText);
      if (recentTexts.length > 5) recentTexts.shift();

      currentGroup = { user: { text }, aiReplies: [] };
      conversationGroups.push(currentGroup);
    }

    // 提取 AI 回复 - 获取整个容器的完整内容
    // 先找到包含 .font-claude-response-body 的容器
    const aiParagraphs = child.querySelectorAll('.font-claude-response-body');
    if (aiParagraphs.length > 0 && !userMsg) {
      const firstParagraph = aiParagraphs[0];
      const containerKey = firstParagraph.textContent?.trim().substring(0, 50);

      if (!processedAiContainers.has(containerKey)) {
        processedAiContainers.add(containerKey);

        // 找到 AI 回复的完整容器（包含标题、段落等所有内容）
        // 从容器的子元素中查找，跳过用户消息容器
        let aiContainer = null;
        for (const el of child.children) {
          if (el.querySelector('.font-claude-response-body')) {
            aiContainer = el;
            break;
          }
        }

        // 收集所有文本内容
        let aiText = '';
        if (aiContainer) {
          // 获取容器内所有可见文本
          aiText = aiContainer.textContent.trim();
        } else {
          // 兜底：收集所有段落的文本
          const paragraphs = [];
          aiParagraphs.forEach(p => {
            const text = p.textContent.trim();
            if (text && text.length > 5) {
              paragraphs.push(text);
            }
          });
          aiText = paragraphs.join('\n\n');
        }

        if (aiText && aiText.length > 10) {
          aiText = cleanChatText(aiText);

          const normalizedText = aiText.trim().replace(/\s+/g, ' ');
          if (recentTexts.includes(normalizedText)) return;
          recentTexts.push(normalizedText);
          if (recentTexts.length > 5) recentTexts.shift();

          if (currentGroup) {
            currentGroup.aiReplies.push(aiText);
          }
        }
      }
    }
  });

  // 根据选中的索引导出
  conversationGroups.forEach((group, index) => {
    if (selectedIndices !== null && !selectedIndices.includes(index)) return;

    md += `## 🙋 ${group.user.text}\n\n`;
    group.aiReplies.forEach(aiText => {
      md += `**🤖 ${getAILabel()} Reply / 回复**:\n\n${formatForMarkdown(aiText)}\n\n`;
      md += `---\n\n`;
    });
  });

  if (conversationGroups.length === 0) {
    md += '> ⚠️ Failed to extract Claude conversation content, selectors may be outdated. / 无法提取 Claude 对话内容，可能选择器已失效。\n';
  }

  return md;
}

// 清理多余文本
function cleanChatText(text) {
  if (!text) return '';

  let cleaned = text.trim();

  // 针对 Gemini 的 "你说 " / "You said" 标签进行清理
  // 移除开头的 "你说" 或 "You said" 以及随后的空白字符（包括换行）
  const labels = [/^你说\s*/, /^You said\s*/i];

  for (const label of labels) {
    if (label.test(cleaned)) {
      cleaned = cleaned.replace(label, '').trim();
    }
  }

  // 移除末尾的 "ChatGPT can make mistakes..." 等
  return cleaned;
}

// 格式化文本为 Markdown，确保在 Obsidian 中正确渲染
function formatForMarkdown(text) {
  if (!text) return '';

  // 1. 处理代码块 ```code``` → 保持原样
  let formatted = text.replace(/```([\s\S]*?)```/g, (match, code) => {
    return '```\n' + code.trim() + '\n```';
  });

  // 2. 处理行内代码 `code` → 保持原样
  formatted = formatted.replace(/`([^`]+)`/g, '`$1`');

  // 3. 处理加粗 **text** 或 __text__ → 保持原样
  formatted = formatted.replace(/(\*\*|__)([^*]+)\1/g, '$1$2$1');

  // 4. 处理列表项 - 或 * 开头，确保前面有空行
  formatted = formatted.replace(/^[\-\*]\s+/gm, '\n$&');

  // 5. 处理数字列表 1. 2. 开头，确保前面有空行
  formatted = formatted.replace(/^\d+\.\s+/gm, '\n$&');

  // 6. 确保段落之间有空行（连续两个以上换行压缩为一个空行）
  formatted = formatted.replace(/\n{3,}/g, '\n\n');

  return formatted;
}

// 专门用于提取标题的清理函数
function cleanGeminiTitle(rawText) {
  const cleaned = cleanChatText(rawText);
  // 取第一行非空文本
  const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l);
  return lines.length > 0 ? lines[0] : '';
}

// 专门用于 Claude 提取标题的清理函数
function cleanClaudeTitle(rawText) {
  const cleaned = cleanChatText(rawText);
  // 取第一行非空文本
  const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l);
  return lines.length > 0 ? lines[0] : '';
}

// 触发下载
function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 渲染目录
function renderTOC() {
  const list = document.getElementById('ai-toc-list');
  if (!list) return;

  // 目录只展示用户提问作为锚点（AI 回复不进目录，但仍保留在 tocItems 中供导出使用）
  const visibleItems = tocItems.filter(i => i.type === 'user');

  // 没有可显示的提问，隐藏整个容器
  if (visibleItems.length === 0) {
    const container = document.getElementById('ai-toc-container');
    if (container) {
      container.style.display = 'none';
    }
    list.innerHTML = ''; // 清空内容
    lastRenderSignature = ''; // 重置签名
    return;
  }

  // 如果有目录项，确保容器显示
  const container = document.getElementById('ai-toc-container');
  if (container && container.style.display === 'none') {
    container.style.display = 'flex';
  }

  // 数据签名：stableId+收藏+文本 完全一致则跳过 DOM 操作。
  // Claude 页面后台 DOM 变化频繁（会触发 observer→updateTOC→本函数），
  // 若每次都 appendChild 重排，hover 锚点时会闪烁。数据没变就不碰 DOM。
  const signature = visibleItems.map(i =>
    i.stableId + ':' + (bookmarkedItems.has(i.stableId) ? 1 : 0) + ':' + i.text
  ).join('|');
  if (signature === lastRenderSignature) return;
  lastRenderSignature = signature;

  // 基于 stableId 的增量更新：复用/新建/删除，并按数据顺序重排
  // 避免按 index 匹配导致的错位（编辑/重试消息后点 A 跳 B、星标贴错条目）
  const existingMap = new Map();
  Array.from(list.children).forEach(div => {
    if (div.dataset.stableId) existingMap.set(div.dataset.stableId, div);
  });

  const seen = new Set();
  visibleItems.forEach(item => {
    seen.add(item.stableId);
    let div = existingMap.get(item.stableId);
    if (!div) {
      div = document.createElement('div');
      div.className = 'ai-toc-item';
      div.dataset.stableId = item.stableId;
    }

    // 根据类型设置不同的类名
    div.classList.remove('user', 'ai');
    div.classList.add(item.type);

    // 更新文本（纯文本，无图标，用 textContent 防 XSS）
    if (div.dataset.tocFp !== item.text) {
      div.textContent = item.text;
      div.dataset.tocFp = item.text;
      div.title = item.text;
    }

    // 更新收藏状态
    div.classList.toggle('bookmarked', bookmarkedItems.has(item.stableId));

    // 更新点击事件（确保闭包里的 item 是最新的）
    div.onclick = createClickHandler(item, div);

    // 按数据顺序重新挂载（已存在的元素 appendChild 会移动它，保持顺序正确）
    list.appendChild(div);
  });

  // 删除已不存在的项
  existingMap.forEach((div, sid) => {
    if (!seen.has(sid)) div.remove();
  });
}

// 切换收藏状态
function toggleBookmark(stableId, div) {
  if (bookmarkedItems.has(stableId)) {
    bookmarkedItems.delete(stableId);
    div.classList.remove('bookmarked');
  } else {
    bookmarkedItems.add(stableId);
    div.classList.add('bookmarked');
  }
  // 持久化到 localStorage
  localStorage.setItem('bookmarkedItems', JSON.stringify([...bookmarkedItems]));
}

// 提取点击处理函数，避免闭包陷阱
function createClickHandler(item, div) {
  return (e) => {
    // 安全包装：点击处理出错时记录而非静默失效
    try {
      // 计算点击位置相对于 div 左侧的距离
      const rect = div.getBoundingClientRect();
      const clickX = e.clientX - rect.left;

      // 只有用户消息才有收藏功能
      // 点击左侧 32px 区域（覆盖收藏图标区域），只切换收藏，不滚动
      if (item.type === 'user' && clickX < 32) {
        toggleBookmark(item.stableId, div);
        return;
      }

      // 否则，滚动到对应元素
      let target = document.getElementById(item.id);

      // 修复 Gemini 等动态页面中元素 ID 丢失或 DOM 重建的问题
      if (!target || !document.body.contains(target)) {
        // 尝试强制刷新一次 DOM 解析
        if (currentPlatform === 'chatgpt') parseChatGPT();
        else if (currentPlatform === 'gemini') parseGemini();
        else if (currentPlatform === 'claude') parseClaude();

        // 尝试通过文本内容重新定位元素
        const newItem = tocItems.find(t => t.text === item.text);
        if (newItem) {
          target = document.getElementById(newItem.id);
        }
      }

      if (target) {
        // 使用 block: 'start' 确保滚动到元素顶部（第一行）
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
        // 高亮一下
        highlightActive(div);

        // 修复 Gemini 跳转不稳定：有时候第一次没滚过去，延时再滚一次
        setTimeout(() => {
          target.scrollIntoView({ behavior: 'auto', block: 'start' });
        }, 150);
      }
    } catch (err) {
      console.error('[AI Chat TOC] click handler failed:', err);
    }
  };
}

function highlightActive(activeDiv) {
  document.querySelectorAll('.ai-toc-item').forEach(el => el.classList.remove('active'));
  activeDiv.classList.add('active');
}

// 导出为图片 - 使用 html2canvas
function exportToImage(selectedIndices, conversationGroups) {
  // 检查 html2canvas 是否可用 - 同时检查 window.html2canvas 和全局 html2canvas
  const html2canvasLib = window.html2canvas || (typeof html2canvas !== 'undefined' ? html2canvas : null);

  if (!html2canvasLib) {
    console.error('[AI Chat TOC] html2canvas not loaded');
    alert('Image library not loaded, please refresh the page and retry / 图片生成库未加载，请刷新页面重试');
    return;
  }

  // 创建隐藏的渲染容器 - 使用 Shadow DOM 隔离样式
  const wrapper = document.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.left = '-9999px';
  wrapper.style.top = '0';
  wrapper.style.width = '800px';
  wrapper.style.zIndex = '-9999';
  document.body.appendChild(wrapper);

  const container = document.createElement('div');
  container.id = 'ai-toc-image-export-container';
  // 强制重置所有继承的样式
  container.style.all = 'initial';
  container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  container.style.fontSize = '16px';
  container.style.lineHeight = '1.5';
  container.style.color = '#1a1a1a';
  container.style.backgroundColor = '#ffffff';
  container.style.width = '800px';
  container.style.padding = '40px';
  container.style.boxSizing = 'border-box';
  wrapper.appendChild(container);

  // 构建 HTML 内容
  let html = `<div style="max-width: 720px; margin: 0 auto;">`;

  // 添加标题
  const pageTitle = document.title || 'AI Chat Export';
  html += `
    <div style="text-align: center; margin-bottom: 40px; padding-bottom: 24px; border-bottom: 2px solid #e5e5e5;">
      <h1 style="font-size: 24px; font-weight: 700; color: #1a1a1a; margin: 0 0 8px 0; font-family: inherit;">${escapeHtml(pageTitle)}</h1>
      <p style="font-size: 14px; color: #6b7280; margin: 0; font-family: inherit;">Export time: / 导出时间：${new Date().toLocaleString()}</p>
    </div>
  `;

  // 添加对话内容
  selectedIndices.forEach(index => {
    const group = conversationGroups[index];
    const aiLabel = getAILabel();

    html += `
      <div style="background: #f9f9f9; border-radius: 12px; padding: 24px; margin-bottom: 20px; border: 1px solid #e5e5e5;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #e5e5e5;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: #3b82f6; display: flex; align-items: center; justify-content: center; color: white; font-size: 16px; flex-shrink: 0;">🙋</div>
          <div style="font-size: 15px; font-weight: 600; color: #1a1a1a; line-height: 1.4; font-family: inherit;">${escapeHtml(group.user.text)}</div>
        </div>
    `;

    // 添加 AI 回复
    if (group.aiReplies.length > 0) {
      group.aiReplies.forEach(aiReply => {
        // aiReply 可能是对象 { text: '...' } 或字符串，需要提取 text 属性
        let aiTextRaw = typeof aiReply === 'string' ? aiReply : (aiReply.text || '');

        // 清理 AI 回复内容，移除过多的换行
        let aiText = cleanChatText(aiTextRaw);
        aiText = aiText.replace(/\n{3,}/g, '\n\n');

        html += `
          <div style="display: flex; gap: 12px; padding-left: 44px; margin-top: 16px;">
            <div style="width: 28px; height: 28px; border-radius: 50%; background: #10b981; display: flex; align-items: center; justify-content: center; color: white; font-size: 14px; flex-shrink: 0; margin-top: 2px;">🤖</div>
            <div style="flex: 1;">
              <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; font-family: inherit;">${aiLabel} Reply / 回复</div>
              <div style="font-size: 14px; color: #374151; line-height: 1.6; white-space: pre-wrap; word-break: break-word; font-family: inherit;">${escapeHtml(aiText)}</div>
            </div>
          </div>
        `;
      });
    }

    html += `</div>`;
  });

  html += `</div>`;
  container.innerHTML = html;

  // 显示 loading 状态
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'ai-toc-image-loading';
  loadingDiv.innerHTML = '<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:white;padding:20px 40px;border-radius:12px;font-size:14px;z-index:99999;">Generating image... / 正在生成图片...</div>';
  document.body.appendChild(loadingDiv);

  // 使用 html2canvas 生成图片
  setTimeout(() => {
    html2canvasLib(container, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: 800,
      width: 800,
      ignoreElements: (el) => el.id === 'ai-toc-image-loading'
    }).then(canvas => {
      // 清理辅助元素（无论下载是否成功都先移除，避免任何情况下遮罩残留）
      const cleanup = () => {
        if (loadingDiv.parentNode) loadingDiv.parentNode.removeChild(loadingDiv);
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      };

      // 下载图片（toBlob 回调里防御 blob 为 null 等异常）
      canvas.toBlob(blob => {
        try {
          if (!blob) throw new Error('canvas.toBlob returned null / 返回空');
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `chat-export-${new Date().toISOString().slice(0, 10)}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (e) {
          console.error('[AI Chat TOC] 图片下载失败:', e);
          alert('Image download failed: / 图片下载失败：' + e.message);
        }
      });

      cleanup();
    }).catch(err => {
      console.error('[AI Chat TOC] 导出图片失败:', err);
      alert('Export image failed: / 导出图片失败：' + err.message);
      if (loadingDiv.parentNode) loadingDiv.parentNode.removeChild(loadingDiv);
      if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
    });
  }, 100);
}

// 显示图片预览
function showImagePreview(selectedIndices, conversationGroups) {
  // 获取选中的索引
  const indices = selectedIndices || [];
  if (indices.length === 0) {
    alert('Please select at least one conversation / 请至少选择一个对话');
    return;
  }

  // 创建预览容器
  const preview = document.createElement('div');
  preview.id = 'ai-toc-image-preview';
  preview.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:99998;display:flex;align-items:center;justify-content:center;';

  const previewContent = document.createElement('div');
  previewContent.style.cssText = 'background:#fff;border-radius:12px;max-width:90%;max-height:90%;overflow:auto;box-shadow:0 4px 24px rgba(0,0,0,0.2);';

  // 构建预览内容 - 与导出图片相同的样式
  const aiLabel = getAILabel();
  let html = `<div style="width:800px;padding:40px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;">`;

  // 标题
  const pageTitle = document.title || 'AI Chat Export';
  html += `
    <div style="text-align:center;margin-bottom:40px;padding-bottom:24px;border-bottom:2px solid #e5e5e5;">
      <h1 style="font-size:24px;font-weight:700;color:#1a1a1a;margin:0 0 8px 0;">${escapeHtml(pageTitle)}</h1>
      <p style="font-size:14px;color:#6b7280;margin:0;">Export time: / 导出时间：${new Date().toLocaleString()}</p>
    </div>
  `;

  // 对话内容
  selectedIndices.forEach(index => {
    const group = conversationGroups[index];

    html += `
      <div style="background:#f9f9f9;border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #e5e5e5;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #e5e5e5;">
          <div style="width:32px;height:32px;border-radius:50%;background:#3b82f6;display:flex;align-items:center;justify-content:center;color:white;font-size:16px;flex-shrink:0;">🙋</div>
          <div style="font-size:15px;font-weight:600;color:#1a1a1a;line-height:1.4;">${escapeHtml(group.user.text)}</div>
        </div>
    `;

    if (group.aiReplies.length > 0) {
      group.aiReplies.forEach(aiReply => {
        let aiTextRaw = typeof aiReply === 'string' ? aiReply : (aiReply.text || '');
        let aiText = cleanChatText(aiTextRaw);
        aiText = aiText.replace(/\n{3,}/g, '\n\n');

        html += `
          <div style="display:flex;gap:12px;padding-left:44px;margin-top:16px;">
            <div style="width:28px;height:28px;border-radius:50%;background:#10b981;display:flex;align-items:center;justify-content:center;color:white;font-size:14px;flex-shrink:0;margin-top:2px;">🤖</div>
            <div style="flex:1;">
              <div style="font-size:12px;color:#6b7280;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">${aiLabel} Reply / 回复</div>
              <div style="font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap;word-break:break-word;">${escapeHtml(aiText)}</div>
            </div>
          </div>
        `;
      });
    }

    html += `</div>`;
  });

  html += `</div>`;

  previewContent.innerHTML = html;
  preview.appendChild(previewContent);

  // 关闭按钮
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close / 关闭预览';
  closeBtn.style.cssText = 'position:absolute;top:20px;right:20px;padding:12px 24px;background:#3b82f6;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer;';
  closeBtn.onclick = () => preview.remove();
  preview.appendChild(closeBtn);

  // 导出按钮
  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'Export Image / 导出图片';
  exportBtn.style.cssText = 'position:absolute;top:20px;right:140px;padding:12px 24px;background:#10b981;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer;';
  exportBtn.onclick = () => {
    preview.remove();
    exportToImage(selectedIndices, conversationGroups);
  };
  preview.appendChild(exportBtn);

  document.body.appendChild(preview);
}

// 启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
