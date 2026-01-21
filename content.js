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
  
  header.innerHTML = `
    <span>目录</span>
    <div class="ai-toc-controls">
      <span class="ai-toc-export" title="导出为Markdown">${downloadIcon}</span>
    </div>
  `;
  
  // 导出功能
  header.querySelector('.ai-toc-export').onclick = exportToMarkdown;
  
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
      newItems.push({
        id: el.id,
        text: text,
        element: el
      });
    }
  });

  // 只有当数量变化或内容变化时才更新（简单比较长度）
  // 实际应用中可以做更精细的 diff，这里先简单全量更新
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
    const text = textDiv.trim().split('\n')[0];
    
    if (!el.id) {
      el.id = 'ai-toc-msg-gemini-' + index;
    }

    if (text) {
      newItems.push({
        id: el.id,
        text: text,
        element: el
      });
    }
  });

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
  
  // 去重（防止同一个元素被多个选择器选中）
  // Set 存储的是引用，可以直接去重
  const uniqueBlocks = new Set([...messageBlocks]);

  if (uniqueBlocks.size > 0) {
      uniqueBlocks.forEach(block => {
          // 判断角色
          // 只要匹配任意一个 User 选择器，或者内部包含 User 元素，就算 User
          const isUser = userSelectors.some(sel => block.matches(sel)) || 
                         block.querySelector('.user-query') !== null;
          
          let text = block.innerText || block.textContent || '';
          text = cleanChatText(text);
          
          if (!text.trim()) return;

          if (isUser) {
              md += `## 🙋 ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}\n\n`;
              md += `**User:**\n\n${text}\n\n`;
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
  // 移除常见的无关文本，如 "Copy code", "Regenerate" 等
  // 这里做一个简单的清理，保留主要内容
  if (!text) return '';
  
  // 移除末尾的 "ChatGPT can make mistakes..." 等
  return text.trim();
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

  list.innerHTML = '';

  if (tocItems.length === 0) {
    // 如果没有目录项，隐藏整个容器
    const container = document.getElementById('ai-toc-container');
    if (container) {
      container.style.display = 'none';
    }
    return;
  }

  // 如果有目录项，确保容器显示
  const container = document.getElementById('ai-toc-container');
  if (container && container.style.display === 'none') {
    container.style.display = 'flex';
  }

  tocItems.forEach(item => {
    const div = document.createElement('div');
    div.className = 'ai-toc-item';
    div.innerText = item.text;
    div.title = item.text; // 鼠标悬停显示全文
    
    div.onclick = () => {
      // 滚动到对应元素
      const target = document.getElementById(item.id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 高亮一下
        highlightActive(div);
      }
    };
    
    list.appendChild(div);
  });
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
