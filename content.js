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
let bookmarkedItems = new Set(
  JSON.parse(localStorage.getItem('bookmarkedItems') || '[]')
); // 存储已收藏的项的 stableId

// 初始化
function init() {
  detectPlatform();
  // 延迟一点创建，确保页面加载
  setTimeout(() => {
    createContainer();
    startObserving();
  }, 1000);
  console.log('[AI Chat TOC] Loaded. Platform:', currentPlatform);
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
    <span>目录</span>
    <div class="ai-toc-controls">
      <span class="ai-toc-export" title="导出为 Markdown">${downloadIcon}</span>
      <span class="ai-toc-pin" title="固定/取消固定">${pinIcon}</span>
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
    // 首先阻止冒泡
    e.stopPropagation();
    // 阻止默认滚动行为，让列表自己处理滚动
    e.preventDefault();
  };

  // 在列表上监听滚动事件（容器不需要，因为列表是滚动元素）
  list.addEventListener('wheel', preventWheelBubble, { passive: false });
  console.log('[AI Chat TOC] Wheel event listeners added');
}

// 开始监听 DOM 变化
function startObserving() {
  // 使用 MutationObserver 监听主要内容区域的变化
  const targetNode = document.body; // 范围稍微大一点，确保能捕获
  const config = { childList: true, subtree: true };

  const callback = function(mutationsList, observer) {
    // 简单防抖，避免过于频繁更新
    if (window.tocUpdateTimeout) clearTimeout(window.tocUpdateTimeout);
    window.tocUpdateTimeout = setTimeout(updateTOC, 500);
  };

  const observer = new MutationObserver(callback);
  observer.observe(targetNode, config);

  // 初始执行一次
  setTimeout(updateTOC, 1000);
}

// 更新目录的核心逻辑
function updateTOC() {
  if (currentPlatform === 'chatgpt') {
    parseChatGPT();
  } else if (currentPlatform === 'gemini') {
    parseGemini();
  } else if (currentPlatform === 'claude') {
    parseClaude();
  }
  renderTOC();
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
    const text = textDiv.trim().split('\n')[0]; // 取第一行作为标题

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
        element: el
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
    const text = textDiv.trim().split('\n')[0]; // 取第一行作为标题

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
        element: el
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
  const mainContainer = document.querySelector(CONFIG.selectors.claude.contentContainer);

  if (!mainContainer) {
    // console.log('[Claude] Main container not found');
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
      const userText = userMsg.textContent.trim();
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

        // 收集所有段落的文本
        let aiText = '';
        aiParagraphs.forEach(p => {
          const text = p.textContent.trim();
          if (text && text.length > 5) {
            if (!aiText) {
              aiText = text; // 取第一段作为标题
            }
          }
        });

        if (aiText && aiText.length > 10) {
          const stableId = `ai-toc-msg-claude-ai-${hashCode(aiText)}`;
          if (!firstParagraph.id) {
            firstParagraph.id = stableId;
          }
          allElements.push({
            el: firstParagraph,
            type: 'ai',
            text: cleanClaudeTitle(aiText)
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
        element: el
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
  markdownContent += `> 导出时间：${new Date().toLocaleString()}\n\n---\n\n`;

  if (currentPlatform === 'chatgpt') {
    markdownContent += extractChatGPTContent(selectedItems);
  } else if (currentPlatform === 'gemini') {
    markdownContent += extractGeminiContent(selectedItems);
  } else if (currentPlatform === 'claude') {
    markdownContent += extractClaudeContent(selectedItems);
  } else {
    markdownContent += '> 无法识别当前平台，导出失败。\n';
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
      : '暂无回复';
    itemsHtml += `
      <div class="export-item" data-group-index="${groupIndex}">
        <label class="export-item-label">
          <input type="checkbox" class="export-checkbox" data-group-index="${groupIndex}" checked>
          <div class="export-item-content">
            <div class="export-item-user">🙋 ${escapeHtml(userText)}</div>
            <div class="export-item-ai">🤖 ${aiLabel} 回复 × ${aiCount} · ${escapeHtml(aiPreview)}</div>
          </div>
        </label>
      </div>
    `;
  });

  dialog.innerHTML = `
    <div class="export-dialog-content">
      <div class="export-dialog-header">
        <h3>选择要导出的对话</h3>
        <div class="export-controls">
          <button id="export-select-all" class="export-btn">全选</button>
          <button id="export-select-none" class="export-btn">取消全选</button>
          <button id="export-select-inverse" class="export-btn">反选</button>
        </div>
      </div>
      <div class="export-items-container">
        ${itemsHtml}
      </div>
      <div class="export-dialog-footer">
        <span class="export-count">已选择：<span id="export-selected-count">${conversationGroups.length}</span> / ${conversationGroups.length}</span>
        <div class="export-actions">
          <button id="export-cancel" class="export-btn export-btn-secondary">取消</button>
          <button id="export-image" class="export-btn export-btn-secondary">导出为图片</button>
          <button id="export-confirm" class="export-btn export-btn-primary">导出所选</button>
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

  // 确认导出 Markdown
  confirmBtn.onclick = () => {
    const selectedIndices = [];
    checkboxes.forEach((cb, index) => {
      if (cb.checked) {
        selectedIndices.push(index);
      }
    });

    if (selectedIndices.length === 0) {
      alert('请至少选择一个对话');
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
    const selectedIndices = [];
    checkboxes.forEach((cb, index) => {
      if (cb.checked) {
        selectedIndices.push(index);
      }
    });

    if (selectedIndices.length === 0) {
      alert('请至少选择一个对话');
      return;
    }

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
        md += `**🤖 ${getAILabel()} 回复**:\n\n${formatForMarkdown(aiText)}\n\n`;
        md += `---\n\n`;
      });
    });
  } else {
    // 兜底策略：使用之前的选择器
    md += '> ⚠️ 无法精确提取对话结构，仅导出目录项。\n\n';
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
      md += `**🤖 ${getAILabel()} 回复**:\n\n${formatForMarkdown(aiText)}\n\n`;
      md += `---\n\n`;
    });
  });

  if (conversationGroups.length === 0) {
    md += '> ⚠️ 无法提取 Gemini 对话内容，可能选择器已失效。\n';
  }

  return md;
}

// 提取 Claude 内容
function extractClaudeContent(selectedIndices = null) {
  let md = '';

  const mainContainer = document.querySelector(CONFIG.selectors.claude.contentContainer);

  if (!mainContainer) {
    md += '> ⚠️ 无法提取 Claude 对话内容，主容器未找到。\n';
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
      md += `**🤖 ${getAILabel()} 回复**:\n\n${formatForMarkdown(aiText)}\n\n`;
      md += `---\n\n`;
    });
  });

  if (conversationGroups.length === 0) {
    md += '> ⚠️ 无法提取 Claude 对话内容，可能选择器已失效。\n';
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

  // 如果没有目录项，隐藏整个容器
  if (tocItems.length === 0) {
    const container = document.getElementById('ai-toc-container');
    if (container) {
      container.style.display = 'none';
    }
    list.innerHTML = ''; // 清空内容
    return;
  }

  // 如果有目录项，确保容器显示
  const container = document.getElementById('ai-toc-container');
  if (container && container.style.display === 'none') {
    container.style.display = 'flex';
  }

  // 增量更新 (Diff) 逻辑
  // 1. 获取当前 DOM 中的所有目录项
  const existingItems = Array.from(list.children);

  // 2. 遍历新的数据
  tocItems.forEach((item, index) => {
    let div = existingItems[index];

    // 如果该位置没有元素，创建新元素
    if (!div) {
      div = document.createElement('div');
      div.className = 'ai-toc-item';
      list.appendChild(div);
    }

    // 根据类型设置不同的类名
    div.classList.remove('user', 'ai');
    div.classList.add(item.type);

    // 更新文本和标题 - 添加类型图标
    const icon = item.type === 'user' ? '💬' : '🤖';
    const displayText = `${icon} ${item.text}`;
    if (div.innerText !== displayText) {
      div.innerText = displayText;
      div.title = item.text;
    }

    // 更新收藏状态 - 直接从 bookmarkedItems Set 检查，而不是依赖 item.bookmarked
    const isBookmarked = bookmarkedItems.has(item.stableId);
    if (isBookmarked) {
      div.classList.add('bookmarked');
    } else {
      div.classList.remove('bookmarked');
    }

    // 更新点击事件（确保闭包里的 item 是最新的）
    div.onclick = createClickHandler(item, div);
  });

  // 3. 删除多余的 DOM 元素
  while (list.children.length > tocItems.length) {
    list.removeChild(list.lastChild);
  }
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
      target.scrollIntoView({ behavior: 'auto', block: 'center' });
      // 高亮一下
      highlightActive(div);

      // 修复 Gemini 跳转不稳定：有时候第一次没滚过去，延时再滚一次
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'auto', block: 'center' });
      }, 150);
    }
  };
}

function highlightActive(activeDiv) {
  document.querySelectorAll('.ai-toc-item').forEach(el => el.classList.remove('active'));
  activeDiv.classList.add('active');
}

// 导出为图片 - 使用 html2canvas
function exportToImage(selectedIndices, conversationGroups) {
  // 动态加载 html2canvas
  const loadHtml2Canvas = () => {
    return new Promise((resolve, reject) => {
      if (window.html2canvas) {
        resolve(window.html2canvas);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      script.onload = () => resolve(window.html2canvas);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  loadHtml2Canvas().then(() => {
    // 创建隐藏的渲染容器
    const container = document.createElement('div');
    container.id = 'ai-toc-image-export-container';
    document.body.appendChild(container);

    // 构建 HTML 内容
    let html = `<div style="max-width: 720px; margin: 0 auto;">`;

    // 添加标题
    const pageTitle = document.title || 'AI Chat Export';
    html += `
      <div style="text-align: center; margin-bottom: 40px; padding-bottom: 24px; border-bottom: 2px solid #e5e5e5;">
        <h1 style="font-size: 24px; font-weight: 700; color: #1a1a1a; margin: 0 0 8px 0;">${escapeHtml(pageTitle)}</h1>
        <p style="font-size: 14px; color: #6b7280; margin: 0;">导出时间：${new Date().toLocaleString()}</p>
      </div>
    `;

    // 添加对话内容
    selectedIndices.forEach(index => {
      const group = conversationGroups[index];
      const aiLabel = getAILabel();

      html += `
        <div class="ai-toc-export-image-item">
          <div class="ai-toc-export-image-user">
            <div class="ai-toc-export-image-user-icon">🙋</div>
            <div class="ai-toc-export-image-user-text">${escapeHtml(group.user.text)}</div>
          </div>
      `;

      // 添加 AI 回复
      if (group.aiReplies.length > 0) {
        group.aiReplies.forEach(aiReply => {
          // 清理 AI 回复内容，移除过多的换行
          let aiText = cleanChatText(aiReply);
          aiText = aiText.replace(/\n{3,}/g, '\n\n');

          html += `
            <div class="ai-toc-export-image-ai">
              <div class="ai-toc-export-image-ai-icon">🤖</div>
              <div style="flex: 1;">
                <div class="ai-toc-export-image-ai-label">${aiLabel} 回复</div>
                <div class="ai-toc-export-image-ai-content">${escapeHtml(aiText)}</div>
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
    loadingDiv.textContent = '正在生成图片...';
    document.body.appendChild(loadingDiv);

    // 使用 html2canvas 生成图片
    setTimeout(() => {
      html2canvas(container, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: 800,
        width: 800
      }).then(canvas => {
        // 下载图片
        canvas.toBlob(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `chat-export-${new Date().toISOString().slice(0,10)}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        });

        // 清理
        document.body.removeChild(container);
        document.body.removeChild(loadingDiv);
      }).catch(err => {
        console.error('导出图片失败:', err);
        alert('导出图片失败：' + err.message);
        document.body.removeChild(container);
        document.body.removeChild(loadingDiv);
      });
    }, 100);
  }).catch(err => {
    console.error('加载 html2canvas 失败:', err);
    alert('加载图片生成库失败，请检查网络连接');
  });
}

// 启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
