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
      // 尝试多种选择器
      userMessageSelectors: [
        'div[data-test-id="user-query"]', // 常见测试ID
        'h2[data-test-id="user-query"]',
        '.user-query', 
        '.query-text',
        'div[class*="user-query"]',
        // 兜底：查找包含特定属性的元素
        'div[data-message-id] [data-test-id="message-content"]' 
      ],
      contentContainer: 'main'
    }
  },
  pollingInterval: 1000 // 轮询间隔（毫秒），用于 MutationObserver 之外的兜底
};

// 状态
let tocItems = [];
let currentPlatform = 'unknown';
let bookmarkedItems = new Set(); // 存储已收藏的项的 ID

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
      <span class="ai-toc-export" title="导出为Markdown">${downloadIcon}</span>
      <span class="ai-toc-pin" title="固定/取消固定">${pinIcon}</span>
    </div>
  `;
  
  // 导出功能
  header.querySelector('.ai-toc-export').onclick = exportToMarkdown;
  
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
  }
  renderTOC();
}

// 解析 ChatGPT 页面
function parseChatGPT() {
  const selector = CONFIG.selectors.chatgpt.userMessage;
  const elements = document.querySelectorAll(selector);

  const newItems = [];

  elements.forEach((el, index) => {
    // 尝试获取文本内容
    // ChatGPT 的文本通常在内部的 div 中
    const textDiv = el.innerText || el.textContent;
    const text = textDiv.trim().split('\n')[0]; // 取第一行作为标题

    // 生成唯一 ID
    if (!el.id) {
      el.id = 'ai-toc-msg-' + index;
    }

    if (text) {
      const newItem = {
        id: el.id,
        text: text,
        element: el
      };
      // 保留收藏状态
      if (bookmarkedItems.has(el.id)) {
        newItem.bookmarked = true;
      }
      newItems.push(newItem);
    }
  });

  // 只有当数量变化或内容变化时才更新（简单比较长度）
  // 实际应用中可以做更精细的 diff，这里先简单全量更新
  // 如果没有变化，直接返回，避免触发重绘
  if (tocItems.length === newItems.length && 
      tocItems.every((item, i) => item.text === newItems[i].text && item.id === newItems[i].id)) {
    return;
  }
  
  tocItems = newItems;
}

// 解析 Gemini 页面
function parseGemini() {
  const selectors = CONFIG.selectors.gemini.userMessageSelectors;
  let elements = [];
  
  // 尝试每一个选择器，直到找到元素
  for (const sel of selectors) {
    const found = document.querySelectorAll(sel);
    if (found && found.length > 0) {
      elements = found;
      // console.log('[AI Chat TOC] Found Gemini elements using:', sel);
      break;
    }
  }

  const newItems = [];
  elements.forEach((el, index) => {
    // Gemini 的文本可能在内部
    const textDiv = el.innerText || el.textContent;
    // 使用新的清理函数，能够跳过 "你说" 等系统标签
    const text = cleanGeminiTitle(textDiv);
    
    if (!el.id) {
      el.id = 'ai-toc-msg-gemini-' + index;
    }

    if (text) {
      const newItem = {
        id: el.id,
        text: text,
        element: el
      };
      // 保留收藏状态
      if (bookmarkedItems.has(el.id)) {
        newItem.bookmarked = true;
      }
      newItems.push(newItem);
    }
  });

  // 简单的 Diff 检查
  if (tocItems.length === newItems.length && 
      tocItems.every((item, i) => item.text === newItems[i].text && item.id === newItems[i].id)) {
    return;
  }

  tocItems = newItems;
}

// 导出为 Markdown
function exportToMarkdown() {
  let markdownContent = '';
  
  // 添加标题
  const title = document.title || 'AI Chat Export';
  markdownContent += `# ${title}\n\n`;
  markdownContent += `> 导出时间: ${new Date().toLocaleString()}\n\n---\n\n`;

  if (currentPlatform === 'chatgpt') {
    markdownContent += extractChatGPTContent();
  } else if (currentPlatform === 'gemini') {
    markdownContent += extractGeminiContent();
  } else {
    markdownContent += '> 无法识别当前平台，导出失败。\n';
  }

  downloadFile(markdownContent, `chat-export-${new Date().toISOString().slice(0,10)}.md`);
}

// 提取 ChatGPT 内容 (问答对)
function extractChatGPTContent() {
  let md = '';
  // 策略：不再依赖 article，直接查找所有消息元素
  const messages = document.querySelectorAll('[data-message-author-role]');
  
  if (messages.length > 0) {
    messages.forEach(msg => {
      const role = msg.getAttribute('data-message-author-role');
      
      let text = msg.innerText || msg.textContent;
      text = cleanChatText(text);

      // 如果内容为空（可能是隐藏元素或加载中），跳过
      if (!text.trim()) return;

      if (role === 'user') {
        md += `## 🙋 ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}\n\n`;
        md += `**User:**\n\n${text}\n\n`;
      } else {
        // 给 AI 的回答加上引用块，增强区分度
        const quotedText = text.split('\n').map(line => `> ${line}`).join('\n');
        md += `**AI:**\n\n${quotedText}\n\n`;
        md += `---\n\n`; // 每个问答对后加分割线
      }
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
function extractGeminiContent() {
  let md = '';
  
  // 1. 获取所有可能的消息块容器
  // Gemini 的结构：用户提问 (.user-query 或 data-test-id="user-query")
  // AI 回答 (.model-response-text 或 data-test-id="model-response")
  
  // 整合 CONFIG 中的选择器以及更多可能的选择器
  const userSelectors = [
    '.user-query',
    'div[data-test-id="user-query"]',
    'h2[data-test-id="user-query"]',
    'span[data-test-id="user-query"]',
    '.query-text',
    'div[class*="user-query"]'
  ];

  const modelSelectors = [
    '.model-response-text',
    'div[data-test-id="model-response"]',
    'div[data-test-id="response-content"]',
    '.response-content',
    'message-content'
  ];

  // 构建一个组合选择器，按文档顺序获取所有消息
  const allSelectors = [...userSelectors, ...modelSelectors].join(', ');
  
  const messageBlocks = document.querySelectorAll(allSelectors);
  
  // 优化：过滤掉嵌套元素（防止父子元素同时被选中导致重复）
  // querySelectorAll 返回的是按文档顺序排列的 NodeList
  // 增加过滤：只保留可见元素
  const blocks = Array.from(messageBlocks).filter(el => el.offsetParent !== null);
  const topLevelBlocks = [];
  
  blocks.forEach(block => {
    // 检查当前 block 是否是 topLevelBlocks 中某个元素的后代
    // 如果是，说明父元素已经被选中了，当前子元素应该忽略
    const isChild = topLevelBlocks.some(parent => parent.contains(block));
    if (!isChild) {
      topLevelBlocks.push(block);
    }
  });

  const recentTexts = []; // 用于连续文本去重 (最近 3 条)

  if (topLevelBlocks.length > 0) {
      topLevelBlocks.forEach(block => {
          // 判断角色
          // 只要匹配任意一个 User 选择器，或者内部包含 User 元素，就算 User
          const isUser = userSelectors.some(sel => block.matches(sel)) || 
                         block.querySelector('.user-query') !== null;
          
          let text = block.innerText || block.textContent || '';
          text = cleanChatText(text);
          
          if (!text.trim()) return;

          // 文本去重：规范化后比较
          const normalizedText = text.trim().replace(/\s+/g, ' ');
          if (recentTexts.includes(normalizedText)) return;
          
          recentTexts.push(normalizedText);
          if (recentTexts.length > 5) recentTexts.shift(); // 保持最近 5 条记录

          if (isUser) {
              const title = text.length > 50 ? text.substring(0, 50) + '...' : text;
              md += `## 🙋 ${title}\n\n`;
              
              // 只有当文本被截断，或者包含换行符（长文本）时，才重复显示 User 内容
              // 这样可以避免短问题在标题和正文中重复出现，提高可读性
              if (text.length > 50 || text.includes('\n')) {
                md += `**User:**\n\n${text}\n\n`;
              }
          } else {
              const quotedText = text.split('\n').map(line => `> ${line}`).join('\n');
              md += `**AI:**\n\n${quotedText}\n\n`;
              md += `---\n\n`;
          }
      });
  } else {
      md += '> ⚠️ 无法提取 Gemini 对话内容，可能选择器已失效。\n';
  }

  return md;
}

// 清理多余文本
function cleanChatText(text) {
  if (!text) return '';
  
  let cleaned = text.trim();
  
  // 针对 Gemini 的 "你说" / "You said" 标签进行清理
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

// 专门用于提取标题的清理函数
function cleanGeminiTitle(rawText) {
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

    // 如果该位置没有元素，或者该位置的元素不是我们要的（这里假设按顺序一一对应）
    // 为了简单稳健，如果 ID 或 文本 不匹配，就直接替换内容
    if (!div) {
      div = document.createElement('div');
      div.className = 'ai-toc-item';
      div.onclick = createClickHandler(item, div);
      list.appendChild(div);
    } else {
      // 检查点击事件是否需要更新（通常闭包不需要，但 ID 可能会变）
      // 这里为了保险，重新绑定一下 onclick 其实开销很小，或者只在 ID 变了时更新
      // 但为了简单，如果文本变了，我们更新文本
      // 如果 ID 变了，我们需要更新点击处理函数
    }

    // 更新文本和标题
    if (div.innerText !== item.text) {
      div.innerText = item.text;
      div.title = item.text;
    }

    // 更新收藏状态
    if (item.bookmarked) {
      div.classList.add('bookmarked');
    } else {
      div.classList.remove('bookmarked');
    }

    // 更新点击事件（确保闭包里的 item 是最新的）
    // 注意：直接重新赋值 onclick 会覆盖旧的
    div.onclick = createClickHandler(item, div);

    // 标记为已处理
  });

  // 3. 删除多余的 DOM 元素
  while (list.children.length > tocItems.length) {
    list.removeChild(list.lastChild);
  }
}

// 切换收藏状态
function toggleBookmark(itemId, div) {
  if (bookmarkedItems.has(itemId)) {
    bookmarkedItems.delete(itemId);
    div.classList.remove('bookmarked');
  } else {
    bookmarkedItems.add(itemId);
    div.classList.add('bookmarked');
  }
}

// 提取点击处理函数，避免闭包陷阱
function createClickHandler(item, div) {
  return (e) => {
    // 如果点击的是左侧收藏图标区域，只切换收藏，不滚动
    const rect = div.getBoundingClientRect();
    const clickX = e.clientX - rect.left;

    if (clickX < 40) {
      // 点击左侧 40px 区域，切换收藏
      toggleBookmark(item.id, div);
      return;
    }

    // 否则，滚动到对应元素
    let target = document.getElementById(item.id);

    // 修复 Gemini 等动态页面中元素 ID 丢失或 DOM 重建的问题
    if (!target || !document.body.contains(target)) {
      // 尝试强制刷新一次 DOM 解析
      if (currentPlatform === 'chatgpt') parseChatGPT();
      else if (currentPlatform === 'gemini') parseGemini();

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

// 启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
