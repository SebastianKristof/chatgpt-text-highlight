/**
 * ChatGPT Text Highlight Extension - Bundled Content Script
 * All modules combined into a single file for Chrome extension compatibility
 */

// ============================================================================
// Shared Utilities: Hash
// ============================================================================

function hashText(text) {
  if (!text) return '';
  const normalized = text.trim().replace(/\s+/g, ' ');
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// ============================================================================
// Shared Utilities: Anchor
// ============================================================================

function buildAnchor({ conversationId, messageId, messageText, selectionText, selectionStart, selectionEnd }) {
  const textHash = hashText(messageText);
  const selectionPrefix = selectionText.substring(0, 32).trim();
  return {
    conversationId,
    messageId: messageId || null,
    textHash,
    selectionPrefix,
    selectionOffsets: {
      start: selectionStart,
      end: selectionEnd
    }
  };
}

function findSelectionOffsets(messageText, selectionText) {
  if (!selectionText || !messageText) return null;
  const normalizedMessage = messageText.replace(/\s+/g, ' ');
  const normalizedSelection = selectionText.trim().replace(/\s+/g, ' ');
  const index = normalizedMessage.indexOf(normalizedSelection);
  if (index === -1) {
    const firstWords = normalizedSelection.split(' ').slice(0, 3).join(' ');
    const fallbackIndex = normalizedMessage.indexOf(firstWords);
    if (fallbackIndex !== -1) {
      return {
        start: fallbackIndex,
        end: fallbackIndex + normalizedSelection.length
      };
    }
    return null;
  }
  return {
    start: index,
    end: index + normalizedSelection.length
  };
}

// ============================================================================
// Storage
// ============================================================================

const STORAGE_KEY = 'snippets';
const SCHEMA_VERSION = 1;

async function loadSnippets() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const data = result[STORAGE_KEY];
    if (!data || !Array.isArray(data.items)) {
      return [];
    }
    if (data.schemaVersion !== SCHEMA_VERSION) {
      return [];
    }
    return data.items;
  } catch (error) {
    console.error('Failed to load snippets:', error);
    return [];
  }
}

async function saveSnippets(snippets) {
  try {
    const data = {
      schemaVersion: SCHEMA_VERSION,
      items: snippets
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  } catch (error) {
    console.error('Failed to save snippets:', error);
    throw error;
  }
}

// ============================================================================
// Selection
// ============================================================================

const MAX_SELECTION_SIZE = 10000;

function getConversationId() {
  return getConversationIdFromUrl(window.location.href);
}

function getConversationIdFromUrl(url) {
  if (!url) return null;
  
  // Prefer the last /c/{id} segment in the URL.
  // This supports URLs like /g/.../c/<uuid> and /c/WEB:<id>.
  const matches = Array.from(String(url).matchAll(/\/c\/([^/?#]+)/g));
  if (matches.length > 0) {
    return decodeURIComponent(matches[matches.length - 1][1]);
  }
  
  // Fallback: query param
  const match2 = String(url).match(/[?&]conversationId=([^&]+)/);
  if (match2) return decodeURIComponent(match2[1]);
  
  return null;
}

function findMessageBlock(node) {
  if (!node) return null;
  let current = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (current) {
    if (current.hasAttribute && current.hasAttribute('data-message-id')) {
      return current;
    }
    if (current.getAttribute && current.getAttribute('data-message-author-role')) {
      return current;
    }
    if (current.className && typeof current.className === 'string') {
      const className = current.className.toLowerCase();
      if (className.includes('message') || className.includes('group')) {
        let parent = current.parentElement;
        while (parent && parent !== document.body) {
          if (parent.hasAttribute && parent.hasAttribute('data-message-id')) {
            return parent;
          }
          parent = parent.parentElement;
        }
        return current;
      }
    }
    current = current.parentElement;
  }
  return null;
}

function getMessageId(messageBlock) {
  if (!messageBlock) return null;
  const messageId = messageBlock.getAttribute?.('data-message-id');
  return messageId || null;
}

function getMessageText(messageBlock) {
  if (!messageBlock) return '';
  const text = messageBlock.innerText || messageBlock.textContent || '';
  return text.trim();
}

function isSelectionInExtensionUI(selection) {
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const element = container.nodeType === Node.ELEMENT_NODE 
    ? container 
    : container.parentElement;
  if (!element) return false;
  let current = element;
  while (current && current !== document.body) {
    if (current.id === 'ce-root' || current.classList?.contains('ce-extension')) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function getSelectionText() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return '';
  return selection.toString().trim();
}

function generateSnippetId() {
  return `snippet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// eslint-disable-next-line no-unused-vars
function buildSnippetFromSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  if (isSelectionInExtensionUI(selection)) {
    return null;
  }
  
  // Get both plain text and markdown versions
  const selectionText = getSelectionText();
  if (!selectionText) return null;
  
  // Convert to markdown to preserve formatting
  const markdownText = selectionToMarkdown(selection);
  const cleanedMarkdown = cleanupMarkdown(markdownText);
  
  let finalText = cleanedMarkdown;
  let truncated = false;
  if (finalText.length > MAX_SELECTION_SIZE) {
    finalText = finalText.substring(0, MAX_SELECTION_SIZE);
    truncated = true;
  }
  
  const range = selection.getRangeAt(0);
  const startNode = range.startContainer;
  const endNode = range.endContainer;
  
  // Find message blocks for both start and end
  const startMessageBlock = findMessageBlock(startNode);
  const endMessageBlock = findMessageBlock(endNode);
  
  // Check if selection spans multiple messages
  const spansMultipleMessages = startMessageBlock && endMessageBlock && 
                                startMessageBlock !== endMessageBlock;
  
  // Use the start message block for anchor (or first one found)
  const messageBlock = startMessageBlock || endMessageBlock;
  
  if (!messageBlock) {
    // No message block found - still create snippet but without anchor
    return {
      id: generateSnippetId(),
      text: finalText,
      conversationId: getConversationId(),
      anchor: null,
      timestamp: Date.now(),
      truncated
    };
  }
  
  const messageId = getMessageId(messageBlock);
  const messageText = getMessageText(messageBlock);
  const conversationId = getConversationId();
  
  // For cross-message selections, offsets won't be accurate, so we'll use prefix matching
  let offsets = null;
  if (!spansMultipleMessages) {
    // Only try to find offsets if selection is within a single message
    offsets = findSelectionOffsets(messageText, selectionText);
  }
  
  const selectionStart = offsets?.start ?? 0;
  const selectionEnd = offsets?.end ?? selectionText.length;
  
  const anchor = buildAnchor({
    conversationId,
    messageId: spansMultipleMessages ? null : messageId, // Don't use messageId for cross-message selections
    messageText: spansMultipleMessages ? '' : messageText, // Don't use messageText for cross-message
    selectionText: selectionText,
    selectionStart,
    selectionEnd
  });
  
  return {
    id: generateSnippetId(),
    text: finalText, // Store markdown version
    conversationId,
    anchor,
    timestamp: Date.now(),
    truncated
  };
}

function buildSnippetFromRangeSnapshot({ selectionText, markdownText, range }) {
  if (!range) return null;
  
  const rawSelectionText = (selectionText || '').trim();
  if (!rawSelectionText) return null;
  
  const cleanedMarkdown = cleanupMarkdown(markdownText || rawSelectionText);
  
  let finalText = cleanedMarkdown;
  let truncated = false;
  if (finalText.length > MAX_SELECTION_SIZE) {
    finalText = finalText.substring(0, MAX_SELECTION_SIZE);
    truncated = true;
  }
  
  const startNode = range.startContainer;
  const endNode = range.endContainer;
  
  // Find message blocks for both start and end
  const startMessageBlock = findMessageBlock(startNode);
  const endMessageBlock = findMessageBlock(endNode);
  
  // Check if selection spans multiple messages
  const spansMultipleMessages = startMessageBlock && endMessageBlock && 
                                startMessageBlock !== endMessageBlock;
  
  // Use the start message block for anchor (or first one found)
  const messageBlock = startMessageBlock || endMessageBlock;
  
  const conversationId = getConversationId();
  
  if (!messageBlock) {
    // No message block found - still create snippet but without anchor
    return {
      id: generateSnippetId(),
      text: finalText,
      conversationId,
      anchor: null,
      timestamp: Date.now(),
      truncated
    };
  }
  
  const messageId = getMessageId(messageBlock);
  const messageText = getMessageText(messageBlock);
  
  // For cross-message selections, offsets won't be accurate, so we'll use prefix matching
  let offsets = null;
  if (!spansMultipleMessages) {
    offsets = findSelectionOffsets(messageText, rawSelectionText);
  }
  
  const selectionStart = offsets?.start ?? 0;
  const selectionEnd = offsets?.end ?? rawSelectionText.length;
  
  const anchor = buildAnchor({
    conversationId,
    messageId: spansMultipleMessages ? null : messageId,
    messageText: spansMultipleMessages ? '' : messageText,
    selectionText: rawSelectionText,
    selectionStart,
    selectionEnd
  });
  
  return {
    id: generateSnippetId(),
    text: finalText,
    conversationId,
    anchor,
    timestamp: Date.now(),
    truncated
  };
}

// ============================================================================
// Navigation
// ============================================================================

const HIGHLIGHT_DURATION = 2500;

function findMessageById(messageId) {
  if (!messageId) return null;
  const selector = `[data-message-id="${messageId}"]`;
  return document.querySelector(selector);
}

function findMessageByTextHash(textHash) {
  if (!textHash) return null;
  const messageBlocks = document.querySelectorAll('[data-message-id], [data-message-author-role]');
  for (const block of messageBlocks) {
    const messageText = (block.innerText || block.textContent || '').trim();
    const blockHash = hashText(messageText);
    if (blockHash === textHash) {
      return block;
    }
  }
  return null;
}

function findMessageByPrefix(selectionPrefix) {
  if (!selectionPrefix) return null;
  const normalizedPrefix = selectionPrefix.trim().toLowerCase();
  const messageBlocks = document.querySelectorAll('[data-message-id], [data-message-author-role]');
  for (const block of messageBlocks) {
    const messageText = (block.innerText || block.textContent || '').trim().toLowerCase();
    if (messageText.includes(normalizedPrefix)) {
      return block;
    }
  }
  return null;
}

function applyTransientHighlight(element, _startOffset, _endOffset) {
  if (!element) return;
  
  // Descoped: Just scroll to the message without DOM manipulation
  // Highlighting specific text ranges was breaking the DOM, so we'll
  // just scroll to the message block for now. Can be enhanced later.
  try {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Optional: Add a subtle flash effect using CSS class (no DOM manipulation)
    element.classList.add('ce-highlight-transient');
    setTimeout(() => {
      if (element && element.parentNode && element.classList) {
        element.classList.remove('ce-highlight-transient');
      }
    }, HIGHLIGHT_DURATION);
  } catch (error) {
    console.warn('Failed to scroll to element:', error);
  }
}

function navigateToSource(snippet, options = {}) {
  if (!snippet || !snippet.anchor) {
    return false;
  }
  const { anchor } = snippet;
  const {
    suppressNotFoundToast = false,
    allowCrossConversationOpen = true
  } = options;
  
  let messageBlock = null;
  if (anchor.messageId) {
    messageBlock = findMessageById(anchor.messageId);
  }
  if (!messageBlock && anchor.textHash) {
    messageBlock = findMessageByTextHash(anchor.textHash);
  }
  if (!messageBlock && anchor.selectionPrefix) {
    messageBlock = findMessageByPrefix(anchor.selectionPrefix);
  }
  if (!messageBlock) {
    // If we couldn't find it in-page and we know the snippet came from another conversation,
    // offer to open the original conversation (user gesture: snippet click).
    const currentConversationId = getConversationId();
    // On the main page (no currentConversationId), or in a different conversation,
    // offer to open the original source conversation (unless disabled by caller).
    if (
      allowCrossConversationOpen &&
      anchor.conversationId &&
      (!currentConversationId || currentConversationId !== anchor.conversationId)
    ) {
      let conversationUrl = `${window.location.origin}/c/${anchor.conversationId}`;
      try {
        const url = new URL(conversationUrl);
        if (snippet.id) {
          url.searchParams.set('ce_snippet_id', snippet.id);
        }
        conversationUrl = url.toString();
      } catch (e) {
        // ignore URL construction issues; fall back to bare URL
      }
      showConfirmModal({
        title: 'Open parent conversation?',
        message: 'This snippet’s source is in a different conversation. Open the original conversation in a new tab?',
        confirmText: 'Open',
        cancelText: 'Cancel'
      }).then((ok) => {
        if (ok) window.open(conversationUrl, '_blank');
      });
      
      // We return false because we didn't navigate in-page.
      // The modal can still open the parent conversation if the user confirms.
      return false;
    }
    if (!suppressNotFoundToast) {
      createToast('Source not found');
    }
    return false;
  }
  if (anchor.selectionOffsets) {
    applyTransientHighlight(
      messageBlock,
      anchor.selectionOffsets.start,
      anchor.selectionOffsets.end
    );
  } else {
    try {
      messageBlock.classList.add('ce-highlight-transient');
      messageBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        if (messageBlock && messageBlock.parentNode && messageBlock.classList) {
          messageBlock.classList.remove('ce-highlight-transient');
        }
      }, HIGHLIGHT_DURATION);
    } catch (error) {
      console.warn('Failed to highlight message block:', error);
    }
  }
  return true;
}

function schedulePendingSnippetHighlight() {
  let snippetId = null;
  try {
    const url = new URL(window.location.href);
    snippetId = url.searchParams.get('ce_snippet_id');
  } catch (e) {
    // ignore
  }
  if (!snippetId) return;
  
  const targetConvId = getConversationId();
  if (!targetConvId) return;
  
  const key = `${snippetId}@${targetConvId}`;
  if (state.lastPendingHighlightKey === key) return;
  state.lastPendingHighlightKey = key;
  
  let attempts = 0;
  const maxAttempts = 20; // ~10s at 500ms intervals
  const interval = setInterval(() => {
    attempts++;
    const currentConvId = getConversationId();
    if (!currentConvId || currentConvId !== targetConvId) {
      clearInterval(interval);
      return;
    }
    
    const snippet = state.items.find(s => s.id === snippetId);
    if (!snippet || !snippet.anchor || snippet.anchor.conversationId !== currentConvId) {
      clearInterval(interval);
      return;
    }
    
    const success = navigateToSource(snippet, {
      suppressNotFoundToast: true,
      allowCrossConversationOpen: false
    });
    if (success || attempts >= maxAttempts) {
      clearInterval(interval);
      if (!success) {
        createToast('Source not found');
      }
    }
  }, 500);
}

// ============================================================================
// Markdown Conversion
// ============================================================================

/**
 * Converts a DOM selection to markdown, preserving formatting.
 * Handles code blocks, lists, headings, bold, italic, etc.
 * Removes extra empty lines and preserves structure.
 */
function selectionToMarkdown(selection) {
  if (!selection || selection.rangeCount === 0) return '';
  
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const element = container.nodeType === Node.ELEMENT_NODE 
    ? container 
    : container.parentElement;
  
  if (!element) {
    return selection.toString();
  }
  
  // Clone the range to avoid modifying the selection
  const clonedRange = range.cloneRange();
  const tempDiv = document.createElement('div');
  tempDiv.appendChild(clonedRange.cloneContents());
  
  // Convert to markdown
  let markdown = elementToMarkdown(tempDiv);
  
  // Clean up extra empty lines (max 2 consecutive newlines)
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  
  // Remove leading/trailing empty lines
  markdown = markdown.replace(/^\n+|\n+$/g, '');
  
  // Clean up empty lines around list items (keep single line between items)
  markdown = markdown.replace(/(\n{2,})([-*+]|\d+\.)/g, '\n$2');
  markdown = markdown.replace(/([-*+]|\d+\.)(\n{2,})/g, '$1\n');
  
  return markdown;
}

function elementToMarkdown(element) {
  if (!element) return '';
  
  let markdown = '';
  const nodes = Array.from(element.childNodes);
  
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nextNode = nodes[i + 1];
    
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      // Preserve text but normalize whitespace within text nodes
      markdown += text;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toLowerCase();
      const text = elementToMarkdown(node);
      
      switch (tagName) {
        case 'p':
          if (text.trim()) {
            markdown += text.trim();
            // Only add newlines if next element is not a list or heading
            const isNextList = nextNode && nextNode.nodeType === Node.ELEMENT_NODE && 
                              (nextNode.tagName?.toLowerCase() === 'ul' || 
                               nextNode.tagName?.toLowerCase() === 'ol');
            if (!isNextList) {
              markdown += '\n\n';
            } else {
              markdown += '\n';
            }
          }
          break;
        case 'br':
          markdown += '\n';
          break;
        case 'strong':
        case 'b':
          markdown += `**${text}**`;
          break;
        case 'em':
        case 'i':
          markdown += `*${text}*`;
          break;
        case 'code':
          // Inline code
          if (node.parentElement?.tagName?.toLowerCase() !== 'pre') {
            markdown += `\`${text}\``;
          } else {
            markdown += text;
          }
          break;
        case 'pre': {
          const codeElement = node.querySelector('code');
          const codeText = codeElement ? codeElement.textContent : node.textContent;
          markdown += '\n```\n' + codeText.trim() + '\n```\n';
          break;
        }
        case 'h1':
          markdown += `# ${text.trim()}\n\n`;
          break;
        case 'h2':
          markdown += `## ${text.trim()}\n\n`;
          break;
        case 'h3':
          markdown += `### ${text.trim()}\n\n`;
          break;
        case 'ul':
        case 'ol': {
          const items = Array.from(node.querySelectorAll('li'));
          items.forEach((item, index) => {
            const itemText = elementToMarkdown(item).trim();
            if (itemText) {
              const prefix = tagName === 'ol' ? `${index + 1}. ` : '- ';
              markdown += prefix + itemText + '\n';
            }
          });
          // Only add newline if there are items and next element exists
          if (items.length > 0 && nextNode) {
            markdown += '\n';
          }
          break;
        }
        case 'li': {
          // Handle nested lists and content
          const childNodes = Array.from(node.childNodes);
          let liContent = '';
          for (const child of childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
              liContent += child.textContent;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
              const childTag = child.tagName?.toLowerCase();
              if (childTag === 'ul' || childTag === 'ol') {
                // Nested list - add newline before
                liContent += '\n' + elementToMarkdown(child);
              } else {
                liContent += elementToMarkdown(child);
              }
            }
          }
          markdown += liContent.trim();
          break;
        }
        case 'blockquote': {
          const lines = text.split('\n').filter(l => l.trim());
          if (lines.length > 0) {
            markdown += lines.map(l => `> ${l.trim()}`).join('\n') + '\n\n';
          }
          break;
        }
        default:
          markdown += text;
      }
    }
  }
  
  return markdown;
}

/**
 * Cleans up markdown text by removing extra empty lines and normalizing spacing.
 * @param {string} text - Markdown text to clean
 * @returns {string} Cleaned markdown text
 */
function cleanupMarkdown(text) {
  if (!text) return '';
  
  // Remove extra empty lines (max 2 consecutive newlines)
  let cleaned = text.replace(/\n{3,}/g, '\n\n');
  
  // Remove leading/trailing empty lines
  cleaned = cleaned.replace(/^\n+|\n+$/g, '');
  
  // Clean up empty lines around list items (keep single line between items)
  cleaned = cleaned.replace(/(\n{2,})([-*+]|\d+\.)/g, '\n$2');
  cleaned = cleaned.replace(/([-*+]|\d+\.)(\n{2,})/g, '$1\n');
  
  return cleaned;
}

// ============================================================================
// UI
// ============================================================================

const CONTAINER_ID = 'ce-root';
const FAB_DRAG_PADDING = 12;
const FAB_DRAG_THRESHOLD = 4;
const FAB_LONG_PRESS_MS = 180;

function createContainer() {
  let container = document.getElementById(CONTAINER_ID);
  if (container) return container;
  container = document.createElement('div');
  container.id = CONTAINER_ID;
  container.className = 'ce-extension';
  document.body.appendChild(container);
  return container;
}

let fabDragState = {
  active: false,
  longPressReady: false,
  moved: false,
  startX: 0,
  startY: 0,
  startLeft: 0,
  startTop: 0,
  width: 0,
  height: 0,
  longPressTimer: null
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getChatHeaderBottom() {
  const header = document.querySelector('header');
  if (!header) return 0;
  const rect = header.getBoundingClientRect();
  return Math.max(0, rect.bottom || 0);
}

function positionPanel(panelEl) {
  if (!panelEl) return;
  const padding = 16;
  const headerBottom = getChatHeaderBottom();
  const top = headerBottom + padding;
  const maxHeight = Math.max(240, window.innerHeight - top - padding);
  panelEl.style.setProperty('--ce-panel-top', `${top}px`);
  panelEl.style.setProperty('--ce-panel-right', `${padding}px`);
  panelEl.style.setProperty('--ce-panel-max-height', `${maxHeight}px`);
}

function applyContainerPosition(left, top) {
  container.style.left = `${left}px`;
  container.style.top = `${top}px`;
  container.style.right = 'auto';
  container.style.bottom = 'auto';
  container.style.transform = 'none';
}

function enableFabDragging(fabEl) {
  fabEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const rect = container.getBoundingClientRect();
    fabDragState.active = true;
    fabDragState.longPressReady = false;
    fabDragState.moved = false;
    fabDragState.startX = e.clientX;
    fabDragState.startY = e.clientY;
    fabDragState.startLeft = rect.left;
    fabDragState.startTop = rect.top;
    fabDragState.width = rect.width;
    fabDragState.height = rect.height;
    if (fabDragState.longPressTimer) {
      clearTimeout(fabDragState.longPressTimer);
    }
    fabDragState.longPressTimer = setTimeout(() => {
      fabDragState.longPressReady = true;
      fabEl.classList.add('ce-fab-dragging');
    }, FAB_LONG_PRESS_MS);
    fabEl.setPointerCapture?.(e.pointerId);
  });
  
  fabEl.addEventListener('pointermove', (e) => {
    if (!fabDragState.active) return;
    if (!fabDragState.longPressReady) return;
    const dx = e.clientX - fabDragState.startX;
    const dy = e.clientY - fabDragState.startY;
    if (!fabDragState.moved && Math.hypot(dx, dy) < FAB_DRAG_THRESHOLD) {
      return;
    }
    fabDragState.moved = true;
    e.preventDefault();
    
    const maxLeft = window.innerWidth - fabDragState.width - FAB_DRAG_PADDING;
    const maxTop = window.innerHeight - fabDragState.height - FAB_DRAG_PADDING;
    const nextLeft = clamp(fabDragState.startLeft + dx, FAB_DRAG_PADDING, maxLeft);
    const nextTop = clamp(fabDragState.startTop + dy, FAB_DRAG_PADDING, maxTop);
    applyContainerPosition(nextLeft, nextTop);
  });
  
  const endDrag = (e) => {
    if (!fabDragState.active) return;
    fabDragState.active = false;
    fabDragState.longPressReady = false;
    fabEl.releasePointerCapture?.(e.pointerId);
    if (fabDragState.longPressTimer) {
      clearTimeout(fabDragState.longPressTimer);
      fabDragState.longPressTimer = null;
    }
    fabEl.classList.remove('ce-fab-dragging');
  };
  
  fabEl.addEventListener('pointerup', endDrag);
  fabEl.addEventListener('pointercancel', endDrag);
}

/**
 * Formats a timestamp with date, weekday, and relative markers.
 * @param {Date} date - Date to format
 * @returns {string} Formatted timestamp string
 */
function formatTimestamp(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const snippetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  
  const daysDiff = Math.floor((today - snippetDate) / (1000 * 60 * 60 * 24));
  
  // Format time
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  // Format weekday
  const weekday = date.toLocaleDateString([], { weekday: 'short' });
  
  // Format date (month and day)
  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  
  // Base format: Time, Weekday, Date
  let formatted = `${timeStr}, ${weekday}, ${dateStr}`;
  
  // Add relative marker in parentheses (always shown)
  if (daysDiff === 0) {
    formatted += ' (Today)';
  } else if (daysDiff === 1) {
    formatted += ' (Yesterday)';
  } else {
    formatted += ` (${daysDiff} days ago)`;
  }
  
  return formatted;
}

function createFAB(count, onClick, onToggleMinimized) {
  const fab = document.createElement('button');
  const isMinimized = state.settings.minimizedMode || false;
  fab.className = isMinimized ? 'ce-fab ce-fab-minimized' : 'ce-fab';
  fab.setAttribute('aria-label', `Collected snippets: ${count}`);
  
  // Create chevron toggle button
  const chevronBtn = document.createElement('button');
  chevronBtn.className = 'ce-fab-chevron';
  chevronBtn.textContent = isMinimized ? '›' : '‹';
  chevronBtn.setAttribute('aria-label', isMinimized ? 'Expand' : 'Minimize');
  chevronBtn.title = isMinimized ? 'Expand' : 'Minimize';
  chevronBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (onToggleMinimized) {
      onToggleMinimized();
    }
  });
  
  if (isMinimized) {
    // Minimized mode: count only, round pill
    fab.innerHTML = `
      <span class="ce-fab-count">${count}</span>
    `;
    if (count === 0) {
      // If count is 0, make semi-transparent (unless explicitly in minimized mode, but still show it)
      fab.style.opacity = '0.5';
    } else {
      fab.style.opacity = '';
    }
    fab.title = 'Collected snippets';
    // Prepend chevron
    fab.insertBefore(chevronBtn, fab.firstChild);
  } else {
    // Full mode: text + count
    fab.innerHTML = `
      <span class="ce-fab-text">Collected</span>
      <span class="ce-fab-count">${count}</span>
    `;
    // Append chevron
    fab.appendChild(chevronBtn);
  }
  
  fab.addEventListener('click', (e) => {
    // Don't toggle panel if clicking chevron
    if (e.target === chevronBtn || chevronBtn.contains(e.target)) {
      return;
    }
    if (fabDragState.moved) {
      fabDragState.moved = false;
      e.preventDefault();
      return;
    }
    onClick(e);
  });
  enableFabDragging(fab);
  return fab;
}

function createSnippetItem(snippet, index, onRemove, onSnippetClick, onCopy, onToggleSelect, isSelected) {
  const item = document.createElement('div');
  item.className = 'ce-snippet-item';
  if (isSelected) {
    item.classList.add('ce-snippet-selected');
  }
  item.setAttribute('data-snippet-id', snippet.id);
  
  // Checkbox for multi-select
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'ce-snippet-checkbox';
  checkbox.checked = isSelected || false;
  checkbox.addEventListener('change', (e) => {
    e.stopPropagation();
    onToggleSelect(snippet.id);
  });
  
  const text = document.createElement('div');
  text.className = 'ce-snippet-text';
  text.textContent = snippet.text;
  text.setAttribute('title', snippet.text);
  text.style.cursor = 'pointer';
  text.addEventListener('click', async () => {
    await onSnippetClick(snippet);
  });
  
  const meta = document.createElement('div');
  meta.className = 'ce-snippet-meta';
  const timestamp = new Date(snippet.timestamp);
  const timeStr = formatTimestamp(timestamp);
  const timeEl = document.createElement('span');
  timeEl.textContent = timeStr;
  meta.appendChild(timeEl);
  if (snippet.duplicateIndex && snippet.duplicateIndex > 1) {
    const dup = document.createElement('span');
    dup.className = 'ce-duplicate-badge';
    dup.textContent = `Duplicate #${snippet.duplicateIndex}`;
    meta.appendChild(dup);
  }
  
  const actions = document.createElement('div');
  actions.className = 'ce-snippet-actions';
  
  const copyBtn = document.createElement('button');
  copyBtn.className = 'ce-btn ce-btn-icon ce-btn-small ce-btn-copy';
  copyBtn.setAttribute('aria-label', 'Copy snippet');
  copyBtn.innerHTML = '📋';
  copyBtn.title = 'Copy to markdown';
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await onCopy(snippet);
  });
  
  const removeBtn = document.createElement('button');
  removeBtn.className = 'ce-btn ce-btn-icon ce-btn-small ce-btn-remove';
  removeBtn.setAttribute('aria-label', 'Remove snippet');
  removeBtn.innerHTML = '×';
  removeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await onRemove(snippet.id);
  });
  
  actions.appendChild(copyBtn);
  actions.appendChild(removeBtn);
  
  item.appendChild(checkbox);
  item.appendChild(text);
  item.appendChild(meta);
  item.appendChild(actions);
  return item;
}

// Virtualization state
let virtualizationState = {
  itemHeight: 120, // Estimated height per item (will be measured)
  buffer: 5, // Number of items to render outside viewport
  measuredHeight: null
};

function createSnippetList({ snippets, onRemove, onSnippetClick, onCopySnippet, onToggleSelect, selectedIds }) {
  const list = document.createElement('div');
  list.className = 'ce-snippet-list';
  
  if (snippets.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'ce-empty-state';
    emptyState.textContent = 'Select text to save a snippet';
    list.appendChild(emptyState);
    return list;
  }
  
  // Store snippets data for virtualization
  list._snippets = snippets;
  list._onRemove = onRemove;
  list._onSnippetClick = onSnippetClick;
  list._onCopySnippet = onCopySnippet;
  list._onToggleSelect = onToggleSelect;
  list._selectedIds = selectedIds;
  
  // Virtualization container
  const virtualContainer = document.createElement('div');
  virtualContainer.className = 'ce-virtual-container';
  list.appendChild(virtualContainer);
  
  // Initial render
  updateVirtualizedList(list);
  
  // Throttled scroll handler
  let scrollTimeout;
  list.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      updateVirtualizedList(list);
    }, 10);
  });
  
  // Resize observer for window resize
  if (window.ResizeObserver) {
    const resizeObserver = new ResizeObserver(() => {
      updateVirtualizedList(list);
    });
    resizeObserver.observe(list);
  }
  
  return list;
}

function updateVirtualizedList(list) {
  const snippets = list._snippets;
  if (!snippets || snippets.length === 0) return;
  
  const container = list.querySelector('.ce-virtual-container');
  if (!container) return;
  
  const containerHeight = list.clientHeight || list.offsetHeight;
  const scrollTop = list.scrollTop || 0;
  
  // If container height is 0, render all items (not yet measured)
  if (containerHeight === 0) {
    container.innerHTML = '';
    snippets.forEach((snippet, index) => {
      const isSelected = list._selectedIds && list._selectedIds.has(snippet.id);
      const item = createSnippetItem(
        snippet,
        index,
        list._onRemove,
        list._onSnippetClick,
        list._onCopySnippet,
        list._onToggleSelect,
        isSelected
      );
      container.appendChild(item);
    });
    // Measure height after render
    requestAnimationFrame(() => {
      if (container.children.length > 0) {
        const firstItem = container.children[0];
        if (firstItem && firstItem.offsetHeight) {
          virtualizationState.measuredHeight = firstItem.offsetHeight;
          virtualizationState.itemHeight = firstItem.offsetHeight;
          // Re-render with virtualization
          updateVirtualizedList(list);
        }
      }
    });
    return;
  }
  
  // Measure item height on first render if not measured
  if (!virtualizationState.measuredHeight && container.children.length > 0) {
    const firstItem = container.querySelector('.ce-snippet-item');
    if (firstItem && firstItem.offsetHeight) {
      virtualizationState.measuredHeight = firstItem.offsetHeight;
      virtualizationState.itemHeight = firstItem.offsetHeight;
    }
  }
  
  const itemHeight = virtualizationState.measuredHeight || virtualizationState.itemHeight;
  const buffer = virtualizationState.buffer;
  
  // Calculate visible range
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
  const endIndex = Math.min(
    snippets.length - 1,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + buffer
  );
  
  // Store previous range to detect changes
  const prevStartIndex = list._startIndex ?? startIndex;
  const prevEndIndex = list._endIndex ?? endIndex;
  
  // Only update if range actually changed
  const rangeChanged = prevStartIndex !== startIndex || prevEndIndex !== endIndex;
  
  // Store current range
  list._startIndex = startIndex;
  list._endIndex = endIndex;
  
  // If range hasn't changed and items exist, skip update to preserve hover states
  if (!rangeChanged && container.children.length > 0) {
    // Still need to update selection states for existing items
    const existingItems = container.querySelectorAll('.ce-snippet-item');
    existingItems.forEach((item, idx) => {
      const actualIndex = startIndex + idx;
      if (actualIndex >= startIndex && actualIndex <= endIndex) {
        const snippet = snippets[actualIndex];
        if (snippet) {
          const isSelected = list._selectedIds && list._selectedIds.has(snippet.id);
          const checkbox = item.querySelector('.ce-snippet-checkbox');
          if (checkbox) {
            checkbox.checked = isSelected || false;
          }
          if (isSelected) {
            item.classList.add('ce-snippet-selected');
          } else {
            item.classList.remove('ce-snippet-selected');
          }
        }
      }
    });
    return;
  }
  
  // Range changed or initial render - rebuild
  // Clear container
  container.innerHTML = '';
  
  // Add top spacer
  const topSpacer = document.createElement('div');
  topSpacer.className = 'ce-virtual-spacer';
  topSpacer.style.height = `${startIndex * itemHeight}px`;
  container.appendChild(topSpacer);
  
  // Render visible items
  for (let i = startIndex; i <= endIndex; i++) {
    const snippet = snippets[i];
    if (!snippet) continue;
    
    const isSelected = list._selectedIds && list._selectedIds.has(snippet.id);
    const item = createSnippetItem(
      snippet,
      i,
      list._onRemove,
      list._onSnippetClick,
      list._onCopySnippet,
      list._onToggleSelect,
      isSelected
    );
    container.appendChild(item);
  }
  
  // Add bottom spacer
  const bottomSpacer = document.createElement('div');
  bottomSpacer.className = 'ce-virtual-spacer';
  bottomSpacer.style.height = `${(snippets.length - endIndex - 1) * itemHeight}px`;
  container.appendChild(bottomSpacer);
}

function createPanelHeader({ onCopy, onCopyAll, onClear, onClearSelected, onClose, onManage, onSelectAll, onSearch, onToggleTheme, onSortToggle, currentTheme, snippetCount, selectedCount, allSelected, searchQuery, totalCount, sortOrder }) {
  const header = document.createElement('div');
  header.className = 'ce-panel-header';
  
  // Title row with close icon
  const titleRow = document.createElement('div');
  titleRow.className = 'ce-panel-title-row';
  
  const title = document.createElement('h2');
  title.className = 'ce-panel-title';
  title.textContent = 'Collected Snippets';
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ce-btn ce-btn-icon';
  closeBtn.setAttribute('aria-label', 'Close panel');
  closeBtn.innerHTML = '×';
  closeBtn.addEventListener('click', onClose);
  
  titleRow.appendChild(title);
  titleRow.appendChild(closeBtn);
  
  // Search box
  const searchContainer = document.createElement('div');
  searchContainer.className = 'ce-search-container';
  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'ce-search-wrapper';
  
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'ce-search-input';
  searchInput.placeholder = 'Search snippets...';
  searchInput.value = searchQuery || '';
  searchInput.setAttribute('aria-label', 'Search snippets');
  searchInput.addEventListener('input', (e) => {
    onSearch(e.target.value);
  });
  
  const clearSearchBtn = document.createElement('button');
  clearSearchBtn.className = 'ce-search-clear';
  clearSearchBtn.innerHTML = '×';
  clearSearchBtn.setAttribute('aria-label', 'Clear search');
  clearSearchBtn.title = 'Clear search';
  clearSearchBtn.style.display = (searchQuery && searchQuery.trim()) ? 'flex' : 'none';
  clearSearchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    searchInput.value = '';
    onSearch('');
  });
  
  searchWrapper.appendChild(searchInput);
  searchWrapper.appendChild(clearSearchBtn);
  searchContainer.appendChild(searchWrapper);
  
  // Button bar (replaces actions row)
  const buttonBar = document.createElement('div');
  buttonBar.className = 'ce-button-bar';
  
  // Select All Checkbox
  const selectAllWrapper = document.createElement('label');
  selectAllWrapper.className = 'ce-select-all-wrapper';
  const selectAllCheckbox = document.createElement('input');
  selectAllCheckbox.type = 'checkbox';
  selectAllCheckbox.className = 'ce-select-all-checkbox';
  selectAllCheckbox.setAttribute('aria-label', 'Select all snippets');
  
  // Determine checkbox state
  const hasSelectedItems = selectedCount > 0;
  const isIndeterminate = hasSelectedItems && !allSelected && snippetCount > 0;
  
  if (allSelected && snippetCount > 0) {
    selectAllCheckbox.checked = true;
    selectAllCheckbox.setAttribute('aria-label', `Deselect all ${selectedCount} snippets`);
    selectAllWrapper.title = `Deselect all ${selectedCount} snippets`;
  } else if (isIndeterminate) {
    selectAllCheckbox.indeterminate = true;
    selectAllCheckbox.setAttribute('aria-label', `${selectedCount} of ${snippetCount} selected`);
    selectAllWrapper.title = `${selectedCount} of ${snippetCount} selected`;
  } else {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.setAttribute('aria-label', `Select all ${snippetCount} snippets`);
    selectAllWrapper.title = `Select all ${snippetCount} snippets`;
  }
  
  selectAllCheckbox.disabled = snippetCount === 0;
  selectAllCheckbox.addEventListener('change', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectAll();
  });
  
  selectAllWrapper.appendChild(selectAllCheckbox);
  buttonBar.appendChild(selectAllWrapper);
  
  // Copy Selected Button
  const copySelectedBtn = document.createElement('button');
  copySelectedBtn.className = 'ce-btn ce-btn-icon ce-button-bar-btn ce-btn-copy-selected';
  copySelectedBtn.innerHTML = '📋';
  copySelectedBtn.setAttribute('aria-label', selectedCount > 0 ? `Copy ${selectedCount} selected snippets` : 'Copy selected');
  copySelectedBtn.title = selectedCount > 0 ? `Copy ${selectedCount} selected` : 'Copy selected';
  copySelectedBtn.disabled = selectedCount === 0;
  copySelectedBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (selectedCount > 0) {
      onCopy();
    }
  });
  buttonBar.appendChild(copySelectedBtn);
  
  // Clear Selected Button
  const clearSelectedBtn = document.createElement('button');
  clearSelectedBtn.className = 'ce-btn ce-btn-icon ce-button-bar-btn ce-btn-clear-selected';
  clearSelectedBtn.innerHTML = '🗑️';
  clearSelectedBtn.setAttribute('aria-label', selectedCount > 0 ? `Clear ${selectedCount} selected snippets` : 'Clear selected');
  clearSelectedBtn.title = selectedCount > 0 ? `Clear ${selectedCount} selected` : 'Clear selected';
  clearSelectedBtn.disabled = selectedCount === 0;
  clearSelectedBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (selectedCount > 0 && onClearSelected) {
      await onClearSelected();
    }
  });
  buttonBar.appendChild(clearSelectedBtn);
  
  // Visual separator (optional)
  const separator = document.createElement('div');
  separator.className = 'ce-button-bar-separator';
  buttonBar.appendChild(separator);
  
  // Copy All Button
  const copyAllBtn = document.createElement('button');
  copyAllBtn.className = 'ce-btn ce-btn-icon ce-button-bar-btn ce-btn-copy-all';
  copyAllBtn.innerHTML = '📄';
  copyAllBtn.setAttribute('aria-label', 'Copy all snippets');
  copyAllBtn.title = 'Copy all snippets';
  copyAllBtn.disabled = snippetCount === 0;
  copyAllBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onCopyAll) {
      onCopyAll();
    }
  });
  buttonBar.appendChild(copyAllBtn);
  
  // Import/Export Button
  const manageBtn = document.createElement('button');
  manageBtn.className = 'ce-btn ce-btn-icon ce-button-bar-btn ce-btn-manage';
  manageBtn.innerHTML = '↕️';
  manageBtn.setAttribute('aria-label', 'Import or export snippets');
  manageBtn.title = 'Import/Export';
  manageBtn.addEventListener('click', onManage);
  buttonBar.appendChild(manageBtn);
  
  // Theme Toggle Button
  if (onToggleTheme && currentTheme) {
    const themeIcons = { auto: '🌓', light: '☀', dark: '🌙' };
    const themeLabels = { auto: 'Auto', light: 'Light', dark: 'Dark' };
    const themeBtn = document.createElement('button');
    themeBtn.className = 'ce-btn ce-btn-icon ce-button-bar-btn ce-btn-theme';
    themeBtn.innerHTML = themeIcons[currentTheme] || '🌓';
    themeBtn.setAttribute('aria-label', `Theme: ${themeLabels[currentTheme] || 'Auto'}`);
    themeBtn.title = `Theme: ${themeLabels[currentTheme] || 'Auto'} (click to change)`;
    themeBtn.addEventListener('click', onToggleTheme);
    buttonBar.appendChild(themeBtn);
  }
  
  // Sort Toggle Button
  if (onSortToggle) {
    const sortBtn = document.createElement('button');
    sortBtn.className = 'ce-btn ce-btn-icon ce-button-bar-btn ce-btn-sort';
    sortBtn.innerHTML = sortOrder === 'desc' ? '↓' : '↑';
    sortBtn.setAttribute('aria-label', `Sort: ${sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}`);
    sortBtn.title = `Sort: ${sortOrder === 'desc' ? 'Newest first (click for oldest)' : 'Oldest first (click for newest)'}`;
    sortBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (onSortToggle) onSortToggle();
    };
    buttonBar.appendChild(sortBtn);
  }
  
  // Snippet Counter (positioned on the right)
  const snippetCounter = document.createElement('div');
  snippetCounter.className = 'ce-snippet-counter';
  // Calculate counts
  const hasSearchQuery = searchQuery && searchQuery.trim();
  const visibleSnippetCount = snippetCount; // Already filtered by search
  const totalSnippetCount = totalCount !== undefined ? totalCount : snippetCount;
  const hasSelectedSnippets = selectedCount > 0;
  
  // Build counter text based on state
  let counterText = '';
  if (hasSelectedSnippets && hasSearchQuery) {
    // Selected + Searched: show selected / found / total
    counterText = `${selectedCount} / ${visibleSnippetCount} / ${totalSnippetCount}`;
  } else if (hasSelectedSnippets) {
    // Selected only: show selected / total
    counterText = `${selectedCount} / ${totalSnippetCount}`;
  } else if (hasSearchQuery && visibleSnippetCount !== totalSnippetCount) {
    // Searched only: show found / total
    counterText = `${visibleSnippetCount} / ${totalSnippetCount}`;
  } else {
    // None selected, no search: show total
    counterText = `${totalSnippetCount}`;
  }
  snippetCounter.textContent = counterText;
  snippetCounter.setAttribute('aria-label', `Snippet count: ${counterText}`);
  buttonBar.appendChild(snippetCounter);
  
  header.appendChild(titleRow);
  header.appendChild(searchContainer);
  header.appendChild(buttonBar);
  return header;
}

function createPanelFooter() {
  const footer = document.createElement('div');
  footer.className = 'ce-panel-footer';
  footer.textContent = 'Click a snippet to navigate to its source';
  return footer;
}

function createPanel({ snippets, onCopy, onCopyAll, onClear, onClearSelected, onClose, onRemove, onSnippetClick, onCopySnippet, onToggleSelect, onSelectAll, onSearch, onManage, onToggleTheme, onSortToggle, currentTheme, selectedIds, searchQuery, totalCount, sortOrder }) {
  const panel = document.createElement('div');
  panel.className = 'ce-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Collected snippets');
  // Check if all visible snippets are selected
  const snippetIds = new Set(snippets.map(s => s.id));
  const allSelected = snippetIds.size > 0 && Array.from(snippetIds).every(id => selectedIds && selectedIds.has(id));
  const header = createPanelHeader({ 
    onCopy,
    onCopyAll,
    onClear,
    onClearSelected,
    onClose, 
    onManage,
    onSelectAll,
    onSearch,
    onToggleTheme,
    onSortToggle,
    currentTheme,
    snippetCount: snippets.length, 
    selectedCount: selectedIds ? selectedIds.size : 0,
    allSelected,
    searchQuery,
    totalCount,
    sortOrder
  });
  const list = createSnippetList({ snippets, onRemove, onSnippetClick, onCopySnippet, onToggleSelect, selectedIds });
  const footer = createPanelFooter();
  panel.appendChild(header);
  panel.appendChild(list);
  panel.appendChild(footer);
  
  // Update virtualization after list is in DOM (for proper height measurement)
  if (list._snippets && list._snippets.length > 0) {
    requestAnimationFrame(() => {
      updateVirtualizedList(list);
    });
  }
  
  return panel;
}

function createToast(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'ce-toast';
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  const container = document.getElementById(CONTAINER_ID) || createContainer();
  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add('ce-toast-show');
  });
  setTimeout(() => {
    toast.classList.remove('ce-toast-show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, duration);
  return toast;
}

// ============================================================================
// Modal dialogs (replace browser confirm/alert)
// ============================================================================

let activeModalOverlay = null;
let activeModalResolve = null;
let activeModalCleanup = null;

function closeActiveModal(result) {
  if (typeof activeModalCleanup === 'function') {
    try { activeModalCleanup(); } catch (e) { /* ignore */ }
  }
  activeModalCleanup = null;
  if (typeof activeModalResolve === 'function') {
    try {
      activeModalResolve(!!result);
    } catch (e) {
      // ignore
    }
  }
  activeModalResolve = null;
  if (activeModalOverlay && activeModalOverlay.parentNode) {
    activeModalOverlay.parentNode.removeChild(activeModalOverlay);
  }
  activeModalOverlay = null;
}

function showConfirmModal({ title, message, confirmText = 'OK', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    // If a modal is already open, close it (resolve false) before showing the next.
    if (activeModalOverlay) {
      closeActiveModal(false);
    }
    activeModalResolve = resolve;
    
    const overlay = document.createElement('div');
    overlay.className = 'ce-modal-overlay';
    overlay.setAttribute('role', 'presentation');
    
    const modal = document.createElement('div');
    modal.className = 'ce-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', title || 'Confirm');
    
    const body = document.createElement('div');
    body.className = 'ce-modal-body';
    
    const h = document.createElement('h3');
    h.className = 'ce-modal-title';
    h.textContent = title || 'Confirm';
    
    const p = document.createElement('p');
    p.className = 'ce-modal-message';
    // Support multi-line messages with proper line breaks
    if (message && message.includes('\n')) {
      p.style.whiteSpace = 'pre-line';
      p.textContent = message;
    } else {
      p.textContent = message || '';
    }
    
    body.appendChild(h);
    body.appendChild(p);
    
    const actions = document.createElement('div');
    actions.className = 'ce-modal-actions';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ce-btn';
    cancelBtn.textContent = cancelText;
    cancelBtn.addEventListener('click', () => closeActiveModal(false));
    
    const okBtn = document.createElement('button');
    okBtn.className = danger ? 'ce-btn ce-btn-danger' : 'ce-btn ce-btn-secondary';
    okBtn.textContent = confirmText;
    okBtn.addEventListener('click', () => closeActiveModal(true));
    
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    
    modal.appendChild(body);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeActiveModal(false);
      }
      if (e.key === 'Enter') {
        // Enter confirms unless focus is on cancel
        if (document.activeElement === cancelBtn) return;
        e.preventDefault();
        closeActiveModal(true);
      }
    };
    
    overlay.addEventListener('mousedown', (e) => {
      // Click outside closes (cancel)
      if (e.target === overlay) closeActiveModal(false);
    });
    
    document.addEventListener('keydown', onKeyDown, { capture: true });
    activeModalCleanup = () => {
      document.removeEventListener('keydown', onKeyDown, { capture: true });
    };
    
    document.body.appendChild(overlay);
    activeModalOverlay = overlay;
    
    requestAnimationFrame(() => {
      modal.classList.add('ce-modal-show');
      // Default focus: cancel for safety (especially for destructive actions)
      cancelBtn.focus();
    });
  });
}

async function showBranchCopyPrompt(fromConversationId, toConversationId, snippetCount) {
  return new Promise((resolve) => {
    // Check if user has set "Don't ask again" preference
    const preferenceKey = `autoCopyOnBranch_${fromConversationId}->${toConversationId}`;
    chrome.storage.local.get([preferenceKey, 'autoCopyOnBranch']).then((result) => {
      const dontAskAgain = result[preferenceKey] || result.autoCopyOnBranch;
      if (dontAskAgain) {
        // User said don't ask again, auto-copy
        resolve(true);
        return;
      }
      
      // Show modal with checkbox
      if (activeModalOverlay) {
        closeActiveModal(false);
      }
      let resolveCalled = false;
      const modalResolve = (value) => {
        if (resolveCalled) return;
        resolveCalled = true;
        resolve(value);
      };
      activeModalResolve = modalResolve;
      
      const overlay = document.createElement('div');
      overlay.className = 'ce-modal-overlay';
      overlay.setAttribute('role', 'presentation');
      
      const modal = document.createElement('div');
      modal.className = 'ce-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'Copy snippets from parent thread?');
      
      const body = document.createElement('div');
      body.className = 'ce-modal-body';
      
      const h = document.createElement('h3');
      h.className = 'ce-modal-title';
      h.textContent = 'Copy snippets from parent thread?';
      
      const p = document.createElement('p');
      p.className = 'ce-modal-message';
      p.textContent = `Copy ${snippetCount} snippet${snippetCount !== 1 ? 's' : ''} from the parent thread to this conversation?`;
      
      const checkboxWrapper = document.createElement('label');
      checkboxWrapper.className = 'ce-modal-checkbox-wrapper';
      checkboxWrapper.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 16px; cursor: pointer;';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'ce-branch-copy-dont-ask';
      
      const checkboxLabel = document.createElement('span');
      checkboxLabel.textContent = "Don't ask again";
      checkboxLabel.style.cssText = 'font-size: 14px; color: var(--ce-text-secondary, #8a8a8a);';
      
      checkboxWrapper.appendChild(checkbox);
      checkboxWrapper.appendChild(checkboxLabel);
      
      body.appendChild(h);
      body.appendChild(p);
      body.appendChild(checkboxWrapper);
      
      const actions = document.createElement('div');
      actions.className = 'ce-modal-actions';
      
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'ce-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        closeActiveModal(false);
        modalResolve(false);
      });
      
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'ce-btn ce-btn-secondary';
      confirmBtn.textContent = 'Copy';
      confirmBtn.addEventListener('click', async () => {
        const dontAsk = checkbox.checked;
        if (dontAsk) {
          // Store preference
          const prefKey = `autoCopyOnBranch_${fromConversationId}->${toConversationId}`;
          await chrome.storage.local.set({ [prefKey]: true });
        }
        closeActiveModal(true);
        modalResolve(true);
      });
      
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      
      modal.appendChild(body);
      modal.appendChild(actions);
      overlay.appendChild(modal);
      
      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeActiveModal(false);
          modalResolve(false);
        }
        if (e.key === 'Enter') {
          if (document.activeElement === cancelBtn) return;
          e.preventDefault();
          confirmBtn.click();
        }
      };
      
      overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) {
          closeActiveModal(false);
          modalResolve(false);
        }
      });
      
      document.addEventListener('keydown', onKeyDown, { capture: true });
      activeModalCleanup = () => {
        document.removeEventListener('keydown', onKeyDown, { capture: true });
      };
      
      document.body.appendChild(overlay);
      activeModalOverlay = overlay;
      
      requestAnimationFrame(() => {
        modal.classList.add('ce-modal-show');
        cancelBtn.focus();
      });
    });
  });
}

function createImportExportModal({ snippetCount, onClose, onExportJson, onExportMarkdown, onPreview, onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'ce-modal-overlay ce-extension';
  overlay.setAttribute('role', 'presentation');
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      onClose();
    }
  });

  const modal = document.createElement('div');
  modal.className = 'ce-modal ce-modal-show';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Import and export');

  const body = document.createElement('div');
  body.className = 'ce-modal-body';

  const titleRow = document.createElement('div');
  titleRow.className = 'ce-modal-title-row';

  const title = document.createElement('h3');
  title.className = 'ce-modal-title';
  title.textContent = 'Import / Export';

  const closeIcon = document.createElement('button');
  closeIcon.className = 'ce-btn ce-btn-icon';
  closeIcon.setAttribute('aria-label', 'Close import/export');
  closeIcon.innerHTML = '×';
  closeIcon.addEventListener('click', onClose);

  titleRow.appendChild(title);
  titleRow.appendChild(closeIcon);

  const message = document.createElement('p');
  message.className = 'ce-modal-message';
  message.textContent = 'Export your snippets as JSON or Markdown, or import a JSON backup.';

  const exportSection = document.createElement('div');
  exportSection.className = 'ce-modal-section';

  const exportLabel = document.createElement('div');
  exportLabel.className = 'ce-modal-label';
  exportLabel.textContent = 'Export';

  const exportRow = document.createElement('div');
  exportRow.className = 'ce-modal-row';

  const exportJsonBtn = document.createElement('button');
  exportJsonBtn.className = 'ce-btn ce-btn-secondary';
  exportJsonBtn.textContent = 'Export JSON';
  exportJsonBtn.disabled = snippetCount === 0;
  exportJsonBtn.addEventListener('click', onExportJson);

  const exportMdBtn = document.createElement('button');
  exportMdBtn.className = 'ce-btn ce-btn-secondary';
  exportMdBtn.textContent = 'Export Markdown';
  exportMdBtn.disabled = snippetCount === 0;
  exportMdBtn.addEventListener('click', onExportMarkdown);

  exportRow.appendChild(exportJsonBtn);
  exportRow.appendChild(exportMdBtn);
  exportSection.appendChild(exportLabel);
  exportSection.appendChild(exportRow);

  const importSection = document.createElement('div');
  importSection.className = 'ce-modal-section';

  const importLabel = document.createElement('div');
  importLabel.className = 'ce-modal-label';
  importLabel.textContent = 'Import (JSON)';

  const radioGroup = document.createElement('div');
  radioGroup.className = 'ce-radio-group';

  const mergeLabel = document.createElement('label');
  mergeLabel.className = 'ce-radio';
  const mergeInput = document.createElement('input');
  mergeInput.type = 'radio';
  mergeInput.name = 'ce-import-mode';
  mergeInput.checked = true;
  mergeLabel.appendChild(mergeInput);
  mergeLabel.append('Merge (skip duplicates)');

  const replaceLabel = document.createElement('label');
  replaceLabel.className = 'ce-radio';
  const replaceInput = document.createElement('input');
  replaceInput.type = 'radio';
  replaceInput.name = 'ce-import-mode';
  replaceLabel.appendChild(replaceInput);
  replaceLabel.append('Replace existing');

  radioGroup.appendChild(mergeLabel);
  radioGroup.appendChild(replaceLabel);

  const importRow = document.createElement('div');
  importRow.className = 'ce-modal-row';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.style.display = 'none';

  const chooseBtn = document.createElement('button');
  chooseBtn.className = 'ce-btn ce-btn-secondary';
  chooseBtn.textContent = 'Choose JSON';
  chooseBtn.addEventListener('click', () => fileInput.click());

  const fileName = document.createElement('div');
  fileName.className = 'ce-file-name';
  fileName.textContent = 'No file selected';

  const status = document.createElement('div');
  status.className = 'ce-import-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'No import yet.';

  const setStatus = (message, type = 'info') => {
    status.textContent = message;
    status.classList.remove('is-success', 'is-error');
    if (type === 'success') status.classList.add('is-success');
    if (type === 'error') status.classList.add('is-error');
  };

  const preview = document.createElement('div');
  preview.className = 'ce-import-preview';
  preview.textContent = 'Select a JSON file to preview import.';

  const setPreview = (message, type = 'info') => {
    preview.textContent = message;
    preview.classList.remove('is-success', 'is-error');
    if (type === 'success') preview.classList.add('is-success');
    if (type === 'error') preview.classList.add('is-error');
  };

  let pendingImport = null;
  let lastFile = null;

  const setPending = (data) => {
    pendingImport = data;
    confirmBtn.disabled = !pendingImport;
  };

  const runPreview = () => {
    if (!lastFile) return;
    const mode = mergeInput.checked ? 'merge' : 'replace';
    onPreview(lastFile, mode, setStatus, setPreview, setPending);
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    lastFile = file;
    fileName.textContent = file.name;
    runPreview();
    fileInput.value = '';
  });

  importRow.appendChild(chooseBtn);
  importRow.appendChild(fileName);

  importSection.appendChild(importLabel);
  importSection.appendChild(radioGroup);
  importSection.appendChild(importRow);
  importSection.appendChild(status);
  importSection.appendChild(preview);

  const actions = document.createElement('div');
  actions.className = 'ce-modal-actions';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'ce-btn ce-btn-secondary';
  confirmBtn.textContent = 'Confirm import';
  confirmBtn.disabled = true;
  confirmBtn.addEventListener('click', () => {
    if (!pendingImport) return;
    const mode = mergeInput.checked ? 'merge' : 'replace';
    onConfirm(pendingImport, mode, setStatus, setPreview, setPending);
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'ce-btn ce-btn-secondary';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', onClose);

  actions.appendChild(confirmBtn);
  actions.appendChild(closeBtn);

  body.appendChild(titleRow);
  body.appendChild(message);
  body.appendChild(exportSection);
  body.appendChild(importSection);

  modal.appendChild(body);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  overlay.appendChild(fileInput);

  mergeInput.addEventListener('change', runPreview);
  replaceInput.addEventListener('change', runPreview);

  return overlay;
}

let selectionToolbar = null;

function createSelectionToolbar(selection, range) {
  // Remove existing toolbar
  if (selectionToolbar) {
    hideSelectionToolbar();
  }
  
  // Create elegant toolbar near the FAB
  const toolbar = document.createElement('div');
  const isMinimized = state.settings.minimizedMode || false;
  toolbar.className = isMinimized ? 'ce-selection-toolbar ce-toolbar-minimized' : 'ce-selection-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Selection actions');
  
  // Snapshot the selection at the time the toolbar is created.
  // Clicking the toolbar can collapse selection on some ChatGPT surfaces (/g/ threads),
  // so we must not rely on window.getSelection() at click time.
  const savedRange = range?.cloneRange ? range.cloneRange() : null;
  const savedSelectionText = (selection?.toString ? selection.toString() : '').trim();
  const savedMarkdown = cleanupMarkdown(selectionToMarkdown(selection));
  
  const saveBtn = document.createElement('button');
  saveBtn.className = 'ce-toolbar-btn';
  saveBtn.innerHTML = '<span class="ce-toolbar-icon">💾</span><span class="ce-toolbar-label">Collect</span>';
  saveBtn.setAttribute('aria-label', 'Collect snippet');
  saveBtn.title = 'Collect snippet';
  
  const copyBtn = document.createElement('button');
  copyBtn.className = 'ce-toolbar-btn';
  copyBtn.innerHTML = '<span class="ce-toolbar-icon">📋</span><span class="ce-toolbar-label">Copy to md</span>';
  copyBtn.setAttribute('aria-label', 'Copy as markdown');
  copyBtn.title = 'Copy as markdown';
  
  // Event handlers
  // Prevent selection collapse when interacting with toolbar/buttons.
  toolbar.addEventListener('mousedown', (e) => {
    e.preventDefault();
  }, { capture: true });
  
  saveBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    const snippet = buildSnippetFromRangeSnapshot({
      selectionText: savedSelectionText,
      markdownText: savedMarkdown,
      range: savedRange
    });
    if (snippet) {
      addSnippet(snippet);
      if (snippet.truncated) {
        createToast('Snippet truncated (max 10,000 characters)');
      } else {
        createToast('Snippet saved');
      }
    } else {
      createToast('Nothing selected');
    }
    hideSelectionToolbar();
    window.getSelection().removeAllRanges();
  });
  
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(savedMarkdown || savedSelectionText);
      createToast('Copied as markdown');
    } catch (error) {
      console.error('Failed to copy:', error);
      createToast('Failed to copy to clipboard');
    }
    hideSelectionToolbar();
    window.getSelection().removeAllRanges();
  });
  
  toolbar.appendChild(saveBtn);
  toolbar.appendChild(copyBtn);
  
  // Append to body (toolbar needs to be outside container for proper positioning)
  // But add class to inherit theme variables
  const container = document.getElementById(CONTAINER_ID);
  if (container) {
    // Copy theme class from container to toolbar
    const themeClass = Array.from(container.classList).find(cls => cls.startsWith('ce-theme-'));
    if (themeClass) {
      toolbar.classList.add(themeClass);
    }
  }
  
  document.body.appendChild(toolbar);
  selectionToolbar = toolbar;
  
  // Position relative to FAB - always grow from FAB
  // Use requestAnimationFrame to ensure layout is calculated
  requestAnimationFrame(() => {
    if (!fab) return;
    
    const padding = 12;
    const fabRect = fab.getBoundingClientRect();
    
    // Get toolbar dimensions after it's in the DOM
    const toolbarWidth = toolbar.offsetWidth || 150; // fallback width
    const toolbarHeight = toolbar.offsetHeight || 80; // fallback height
    
    // Position toolbar above FAB, aligned to the right
    const desiredTop = fabRect.top - toolbarHeight - padding;
    const desiredLeft = fabRect.right - toolbarWidth;
    
    // Ensure toolbar stays within viewport
    const headerBottom = getChatHeaderBottom();
    const safeTop = headerBottom + padding;
    const safeBottom = window.innerHeight - toolbarHeight - padding;
    const clampedTop = clamp(desiredTop, safeTop, safeBottom);
    
    toolbar.style.left = `${Math.max(padding, desiredLeft)}px`;
    toolbar.style.top = `${clampedTop}px`;
    
    // Animate in after positioning
    toolbar.classList.add('ce-toolbar-show');
  });
}

function hideSelectionToolbar() {
  if (selectionToolbar) {
    const toolbarToRemove = selectionToolbar;
    selectionToolbar = null;
    toolbarToRemove.classList.remove('ce-toolbar-show');
    setTimeout(() => {
      if (toolbarToRemove && toolbarToRemove.parentNode) {
        toolbarToRemove.parentNode.removeChild(toolbarToRemove);
      }
    }, 200);
  }
}

function updateFABCount(fab, count) {
  const countEl = fab.querySelector('.ce-fab-count');
  if (countEl) {
    countEl.textContent = count;
  }
  fab.setAttribute('aria-label', `Collected snippets: ${count}`);
  
  // Update opacity for minimized mode when count is 0
  const isMinimized = fab.classList.contains('ce-fab-minimized');
  if (isMinimized) {
    if (count === 0) {
      fab.style.opacity = '0.5';
    } else {
      fab.style.opacity = '';
    }
  }
}

function updatePanel(panel, snippets, onRemove, onSnippetClick, onCopySnippet, onToggleSelect, onSelectAll, onSearch, selectedIds, searchQuery, totalCount, sortOrder, onSortToggle, onClearSelected, onToggleTheme) {
  const list = panel.querySelector('.ce-snippet-list');
  if (!list) return;
  
  if (snippets.length === 0) {
    list.innerHTML = '';
    const emptyState = document.createElement('div');
    emptyState.className = 'ce-empty-state';
    if (searchQuery && searchQuery.trim()) {
      emptyState.textContent = 'No snippets match your search';
    } else {
      emptyState.textContent = 'Select text to save a snippet';
    }
    list.appendChild(emptyState);
  } else {
    // Clear any empty state
    list.innerHTML = '';
    
    // Ensure virtual container exists (it might not exist if we transitioned from empty state)
    let container = list.querySelector('.ce-virtual-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'ce-virtual-container';
      list.appendChild(container);
      
      // Re-attach scroll handler if it was lost
      let scrollTimeout;
      list.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          updateVirtualizedList(list);
        }, 10);
      });
      
      // Re-attach resize observer if it was lost
      if (window.ResizeObserver) {
        const resizeObserver = new ResizeObserver(() => {
          updateVirtualizedList(list);
        });
        resizeObserver.observe(list);
      }
    }
    
    // Update virtualization data
    list._snippets = snippets;
    list._onRemove = onRemove;
    list._onSnippetClick = onSnippetClick;
    list._onCopySnippet = onCopySnippet;
    list._onToggleSelect = onToggleSelect;
    list._selectedIds = selectedIds;
    
    // Update virtualized list (use requestAnimationFrame to ensure DOM is ready)
    requestAnimationFrame(() => {
      updateVirtualizedList(list);
    });
  }
  
  // Update search input and clear button
  const searchInput = panel.querySelector('.ce-search-input');
  const clearSearchBtn = panel.querySelector('.ce-search-clear');
  if (searchInput && searchInput.value !== searchQuery) {
    searchInput.value = searchQuery || '';
  }
  if (clearSearchBtn) {
    clearSearchBtn.style.display = (searchQuery && searchQuery.trim()) ? 'flex' : 'none';
  }
  
  // Update button bar
  const selectedCount = selectedIds ? selectedIds.size : 0;
  const snippetIds = new Set(snippets.map(s => s.id));
  const allSelected = snippetIds.size > 0 && Array.from(snippetIds).every(id => selectedIds && selectedIds.has(id));
  const hasSelection = selectedCount > 0;
  const isIndeterminate = hasSelection && !allSelected && snippets.length > 0;
  
  // Update select all checkbox
  const selectAllCheckbox = panel.querySelector('.ce-select-all-checkbox');
  const selectAllWrapper = panel.querySelector('.ce-select-all-wrapper');
  if (selectAllCheckbox) {
    if (allSelected && snippets.length > 0) {
      selectAllCheckbox.checked = true;
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.setAttribute('aria-label', `Deselect all ${selectedCount} snippets`);
      if (selectAllWrapper) selectAllWrapper.title = `Deselect all ${selectedCount} snippets`;
    } else if (isIndeterminate) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = true;
      selectAllCheckbox.setAttribute('aria-label', `${selectedCount} of ${snippets.length} selected`);
      if (selectAllWrapper) selectAllWrapper.title = `${selectedCount} of ${snippets.length} selected`;
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.setAttribute('aria-label', `Select all ${snippets.length} snippets`);
      if (selectAllWrapper) selectAllWrapper.title = `Select all ${snippets.length} snippets`;
    }
    selectAllCheckbox.disabled = snippets.length === 0;
  }
  
  // Update copy selected button
  const copySelectedBtn = panel.querySelector('.ce-btn-copy-selected');
  if (copySelectedBtn) {
    copySelectedBtn.disabled = selectedCount === 0;
    copySelectedBtn.setAttribute('aria-label', selectedCount > 0 ? `Copy ${selectedCount} selected snippets` : 'Copy selected');
    copySelectedBtn.title = selectedCount > 0 ? `Copy ${selectedCount} selected` : 'Copy selected';
  }
  
  // Update clear selected button
  const clearSelectedBtn = panel.querySelector('.ce-btn-clear-selected');
  if (clearSelectedBtn) {
    clearSelectedBtn.disabled = selectedCount === 0;
    clearSelectedBtn.setAttribute('aria-label', selectedCount > 0 ? `Clear ${selectedCount} selected snippets` : 'Clear selected');
    clearSelectedBtn.title = selectedCount > 0 ? `Clear ${selectedCount} selected` : 'Clear selected';
  }
  
  // Update copy all button
  const copyAllBtn = panel.querySelector('.ce-btn-copy-all');
  if (copyAllBtn) {
    copyAllBtn.disabled = snippets.length === 0;
  }
  
  // Update sort button
  const sortBtn = panel.querySelector('.ce-btn-sort');
  if (sortBtn && sortOrder) {
    sortBtn.innerHTML = sortOrder === 'desc' ? '↓' : '↑';
    sortBtn.setAttribute('aria-label', `Sort: ${sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}`);
    sortBtn.title = `Sort: ${sortOrder === 'desc' ? 'Newest first (click for oldest)' : 'Oldest first (click for newest)'}`;
    sortBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (onSortToggle) onSortToggle();
    };
  }
  
  // Update snippet counter
  const snippetCounter = panel.querySelector('.ce-snippet-counter');
  if (snippetCounter) {
    const hasSearchQuery = searchQuery && searchQuery.trim();
    const visibleSnippetCount = snippets.length; // Already filtered by search
    const totalSnippetCount = totalCount !== undefined ? totalCount : snippets.length;
    const hasSelectedSnippets = selectedCount > 0;
    
    // Build counter text based on state
    let counterText = '';
    if (hasSelectedSnippets && hasSearchQuery) {
      // Selected + Searched: show selected / found / total
      counterText = `${selectedCount} / ${visibleSnippetCount} / ${totalSnippetCount}`;
    } else if (hasSelectedSnippets) {
      // Selected only: show selected / total
      counterText = `${selectedCount} / ${totalSnippetCount}`;
    } else if (hasSearchQuery && visibleSnippetCount !== totalSnippetCount) {
      // Searched only: show found / total
      counterText = `${visibleSnippetCount} / ${totalSnippetCount}`;
    } else {
      // None selected, no search: show total
      counterText = `${totalSnippetCount}`;
    }
    snippetCounter.textContent = counterText;
    snippetCounter.setAttribute('aria-label', `Snippet count: ${counterText}`);
  }
  
  // Update theme button (if it exists)
  const themeBtn = panel.querySelector('.ce-btn-theme');
  if (themeBtn && onToggleTheme) {
    // Theme button state is managed by the theme toggle handler, no update needed here
  }
}

// ============================================================================
// Main Content Script
// ============================================================================

let state = {
  items: [], // All snippets across all conversations
  panelOpen: false,
  selectedIds: new Set(),
  currentConversationId: null,
  searchQuery: '',
  sortOrder: 'desc', // 'desc' for newest first, 'asc' for oldest first
  settings: {
    theme: 'auto', // Default to auto (follows system)
    minimizedMode: false // Default to full mode
  },
  // When ChatGPT navigates to a new thread, it can take a moment for the URL to include the new conversationId.
  // We track the previous conversation so we can offer to copy snippets forward once the new ID exists.
  pendingTransferFromConversationId: null,
  pendingTransferFromMessageHashes: null,
  // Set when the user explicitly clicks ChatGPT's "Branch in new chat" menu item.
  // Used to avoid heuristics when we *know* the next navigation is a branch.
  pendingExplicitBranch: null,
  lastAutoTransferKey: null,
  lastTransferPromptKey: null,
  lastPendingHighlightKey: null
};

let container = null;
let fab = null;
let panel = null;
let importExportModal = null;
let modalOpen = false;

function snippetKey(snippet) {
  const anchor = snippet?.anchor || {};
  const offsets = anchor.selectionOffsets || {};
  return [
    hashText(snippet?.text || ''),
    snippet?.conversationId || '',
    anchor.textHash || '',
    offsets.start ?? '',
    offsets.end ?? ''
  ].join('|');
}

function normalizeImportedSnippet(raw) {
  if (!raw || typeof raw.text !== 'string') return null;
  const text = raw.text.trim();
  if (!text) return null;
  return {
    id: typeof raw.id === 'string' ? raw.id : generateSnippetId(),
    text,
    conversationId: typeof raw.conversationId === 'string' ? raw.conversationId : null,
    anchor: raw.anchor && typeof raw.anchor === 'object' ? raw.anchor : null,
    timestamp: Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now(),
    truncated: Boolean(raw.truncated)
  };
}

function normalizeImportedSnippets(items) {
  return items
    .map(normalizeImportedSnippet)
    .filter(Boolean);
}

function expandImportDuplicates(items) {
  const seen = new Map();
  const expanded = [];
  let duplicates = 0;
  items.forEach((snippet) => {
    const key = snippetKey(snippet);
    const count = seen.get(key) || 0;
    if (count === 0) {
      expanded.push(snippet);
    } else {
      expanded.push({
        ...snippet,
        id: generateSnippetId(),
        duplicateIndex: count + 1
      });
      duplicates += 1;
    }
    seen.set(key, count + 1);
  });
  return { items: expanded, duplicates };
}

// eslint-disable-next-line no-unused-vars
function dedupeSnippets(items) {
  const seen = new Set();
  const deduped = [];
  let skipped = 0;
  items.forEach((snippet) => {
    const key = snippetKey(snippet);
    if (seen.has(key)) {
      skipped += 1;
      return;
    }
    seen.add(key);
    deduped.push(snippet);
  });
  return { items: deduped, skipped };
}

function mergeSnippets(existing, incoming) {
  const existingMap = new Map(existing.map((snippet) => [snippetKey(snippet), snippet]));
  const existingKeys = new Set(existingMap.keys());
  const seenIncoming = new Set();
  const merged = [];
  let added = 0;
  let skipped = 0;
  incoming.forEach((snippet) => {
    const key = snippetKey(snippet);
    if (seenIncoming.has(key)) {
      skipped += 1;
      return;
    }
    seenIncoming.add(key);
    if (existingMap.has(key)) {
      skipped += 1;
      merged.push(existingMap.get(key));
      return;
    }
    merged.push(snippet);
    added += 1;
  });
  existing.forEach((snippet) => {
    const key = snippetKey(snippet);
    if (!seenIncoming.has(key) && existingKeys.has(key)) {
      merged.push(snippet);
    }
  });
  return { items: merged, added, skipped };
}

function buildMarkdownFromSnippets(snippets) {
  const combined = snippets
    .map((snippet) => cleanupMarkdown(snippet.text))
    .join('\n\n');
  return cleanupMarkdown(combined);
}

function downloadTextFile(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
}

function exportFilename(extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `chatgpt-snippets-${stamp}.${extension}`;
}

// ============================================================================
// Branch detection helpers
// ============================================================================

function getConversationMessageHashes(maxMessages = 10) {
  try {
    const blocks = Array.from(document.querySelectorAll('[data-message-id], [data-message-author-role]'));
    const hashes = [];
    for (const block of blocks) {
      if (hashes.length >= maxMessages) break;
      const text = getMessageText(block);
      if (!text) continue;
      hashes.push(hashText(text));
    }
    return hashes;
  } catch (e) {
    return [];
  }
}

function isLikelyBranch(previousHashes, currentHashes) {
  if (!previousHashes?.length || !currentHashes?.length) return false;
  const prevSet = new Set(previousHashes);
  let intersection = 0;
  for (const h of currentHashes) {
    if (prevSet.has(h)) intersection++;
  }
  const denom = Math.min(previousHashes.length, currentHashes.length);
  if (denom === 0) return false;
  
  // Heuristic: branched threads share most early messages.
  // Require at least 3 shared messages and >=60% overlap on the smaller sample.
  return intersection >= 3 && (intersection / denom) >= 0.6;
}

function installBranchInNewChatObserver() {
  const BRANCH_TEXT_PATTERNS = [/^branch in new chat$/i];
  
  function looksLikeBranchMenuItem(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    // Prefer stable accessibility attributes when present (Radix menu items commonly use these).
    const ariaLabel = (el.getAttribute?.('aria-label') || '').trim();
    if (ariaLabel && BRANCH_TEXT_PATTERNS.some((re) => re.test(ariaLabel))) return true;
    
    const text = (el.textContent || '').trim();
    if (!text) return false;
    return BRANCH_TEXT_PATTERNS.some((re) => re.test(text));
  }
  
  function attachHandler(el) {
    if (!el || el.dataset?.ceBranchHandlerAttached) return;
    el.dataset.ceBranchHandlerAttached = '1';
    
    el.addEventListener('click', () => {
      const fromConversationId = getConversationId();
      if (!fromConversationId) return;
      state.pendingExplicitBranch = {
        fromConversationId,
        at: Date.now(),
        fromMessageHashes: getConversationMessageHashes(10)
      };
    }, { capture: true });
  }
  
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
        const root = /** @type {Element} */ (node);
        
        // Try the node itself
        if (looksLikeBranchMenuItem(root)) attachHandler(root);
        
        // And any descendants (menu items are often nested)
        const candidates = root.querySelectorAll?.('[role="menuitem"], [role="menuitem"] *, button, a, div');
        if (!candidates) continue;
        for (const el of candidates) {
          if (looksLikeBranchMenuItem(el)) attachHandler(el);
        }
      }
    }
  });
  
  try {
    observer.observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    // ignore
  }
}

function installBranchInNewChatClickCapture() {
  const BRANCH_TEXT_PATTERNS = [/^branch in new chat$/i];
  
  function isBranchEl(el) {
    if (!el) return false;
    const ariaLabel = (el.getAttribute?.('aria-label') || '').trim();
    if (ariaLabel && BRANCH_TEXT_PATTERNS.some((re) => re.test(ariaLabel))) return true;
    const text = (el.textContent || '').trim();
    return !!text && BRANCH_TEXT_PATTERNS.some((re) => re.test(text));
  }
  
  document.addEventListener('click', (e) => {
    const target = /** @type {Element|null} */ (e.target && e.target.nodeType === Node.ELEMENT_NODE ? e.target : null);
    if (!target) return;
    
    // Radix menu item is typically the closest [role="menuitem"] wrapper.
    const menuItem = target.closest?.('[role="menuitem"]') || target;
    if (!menuItem) return;
    if (!isBranchEl(menuItem)) return;
    
    const fromConversationId = getConversationId();
    if (!fromConversationId) return;
    state.pendingExplicitBranch = {
      fromConversationId,
      at: Date.now(),
      fromMessageHashes: getConversationMessageHashes(10)
    };
  }, { capture: true });
}

function copySnippetsToConversation({ fromConversationId, toConversationId }) {
  if (!fromConversationId || !toConversationId || fromConversationId === toConversationId) {
    return 0;
  }
  const fromSnippets = state.items.filter(s => s.conversationId === fromConversationId);
  const toSnippets = state.items.filter(s => s.conversationId === toConversationId);
  if (fromSnippets.length === 0 || toSnippets.length > 0) {
    return 0;
  }
  const copied = fromSnippets.map((s) => ({
    ...s,
    id: generateSnippetId(),
    conversationId: toConversationId,
    transferredFromConversationId: fromConversationId,
    anchor: s.anchor ? { ...s.anchor } : s.anchor
  }));
  state.items = [...state.items, ...copied];
  persistState();
  updateUI();
  return copied.length;
}

function findBranchedFromConversationId() {
  try {
    const toConvId = getConversationId();

    // Single, structure-only hook (locale-safe, no global scanning):
    // <div class="mx-auto mt-8 flex w-full items-center justify-center"> ... <p class="... text-xs ..."> <a target="_self" href=".../c/...">
    const a = document.querySelector(
      'div.mx-auto.mt-8.flex.w-full.items-center.justify-center p.text-xs a[target="_self"][href*="/c/"]'
    );
    if (!a) return null;

    const href = a.getAttribute('href') || '';
    if (!href) return null;
    const abs = new URL(href, window.location.origin).href;
    const fromId = getConversationIdFromUrl(abs);
    if (!fromId) return null;
    if (toConvId && fromId === toConvId) return null;
    return fromId;
  } catch (e) {
    // ignore
  }
  return null;
}

function scheduleBranchedFromTransferCheck() {
  const toConvId = getConversationId();
  if (!toConvId) return;
  
  // Try a few times — the footer often appears after the first render.
  let attempts = 0;
  const maxAttempts = 12; // ~6s
  const interval = setInterval(() => {
    attempts++;
    const currentTo = getConversationId();
    if (!currentTo || currentTo !== toConvId) {
      clearInterval(interval);
      return;
    }
    
    const fromId = findBranchedFromConversationId();
    if (!fromId) {
      if (attempts >= maxAttempts) clearInterval(interval);
      return;
    }
    
    const key = `${fromId}->${toConvId}`;
    if (state.lastAutoTransferKey === key) {
      clearInterval(interval);
      return;
    }
    state.lastAutoTransferKey = key;
    
    // Check if there are snippets to copy
    const fromSnippets = state.items.filter(s => s.conversationId === fromId);
    if (fromSnippets.length === 0) {
      clearInterval(interval);
      return;
    }
    
    // Show confirmation prompt
    showBranchCopyPrompt(fromId, toConvId, fromSnippets.length).then((shouldCopy) => {
      if (shouldCopy) {
        const copiedCount = copySnippetsToConversation({ fromConversationId: fromId, toConversationId: toConvId });
        if (copiedCount > 0) {
          createToast(`Copied ${copiedCount} snippet${copiedCount !== 1 ? 's' : ''} from parent thread`);
        }
      }
      clearInterval(interval);
    });
  }, 500);
}

/**
 * Applies theme to the extension UI.
 * @param {string} theme - Theme mode: 'light', 'dark', or 'auto'
 */
function applyTheme(theme) {
  if (!container) return;
  
  container.classList.remove('ce-theme-light', 'ce-theme-dark');
  
  if (theme === 'auto') {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    container.classList.add(prefersDark ? 'ce-theme-dark' : 'ce-theme-light');
  } else {
    container.classList.add(`ce-theme-${theme}`);
  }
  
  // Update panel theme class if panel exists
  if (panel) {
    panel.classList.remove('ce-theme-light', 'ce-theme-dark');
    if (theme === 'auto') {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      panel.classList.add(prefersDark ? 'ce-theme-dark' : 'ce-theme-light');
    } else {
      panel.classList.add(`ce-theme-${theme}`);
    }
  }
}

/**
 * Gets current theme setting.
 * @returns {string} Current theme
 */
function getCurrentTheme() {
  return state.settings.theme || 'auto';
}

/**
 * Handles theme toggle.
 */
async function handleToggleTheme() {
  const currentTheme = getCurrentTheme();
  let nextTheme;
  
  // Cycle through: auto -> light -> dark -> auto
  if (currentTheme === 'auto') {
    nextTheme = 'light';
  } else if (currentTheme === 'light') {
    nextTheme = 'dark';
  } else {
    nextTheme = 'auto';
  }
  
  state.settings.theme = nextTheme;
  applyTheme(nextTheme);
  await persistState();
  updateUI();
  
  const themeLabels = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  createToast(`Theme: ${themeLabels[nextTheme]}`);
}

async function handleToggleMinimized() {
  state.settings.minimizedMode = !state.settings.minimizedMode;
  await persistState();
  renderUI();
}

async function init() {
  container = createContainer();
  await loadState();
  
  // Apply theme
  applyTheme(state.settings.theme || 'auto');
  
  // Listen to system theme changes for auto mode
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (state.settings.theme === 'auto') {
        applyTheme('auto');
      }
    });
  }
  
  state.currentConversationId = getConversationId();
  renderUI();
  setupEventListeners();
  // Prefer click-capture (no reliance on ephemeral IDs). Observer remains as a secondary path.
  installBranchInNewChatClickCapture();
  installBranchInNewChatObserver();
  
  // Watch for conversation changes
  watchConversationChanges();
  // If this tab was opened for a specific snippet, schedule a highlight once the DOM is ready.
  schedulePendingSnippetHighlight();
  
  const currentSnippets = getCurrentConversationSnippets();
  if (currentSnippets.length > 0) {
    const url = window.location.href;
    const isMainPage = !url.includes('/c/') && !url.includes('conversationId=');
    // Show "Loaded X snippets" toast only once per session
    const toastShown = sessionStorage.getItem('ce_snippets_loaded_toast_shown');
    if (!toastShown && currentSnippets.length > 0) {
      if (isMainPage) {
        createToast(`Loaded ${currentSnippets.length} snippet${currentSnippets.length !== 1 ? 's' : ''}`);
      } else if (state.currentConversationId) {
        createToast(`Loaded ${currentSnippets.length} snippet${currentSnippets.length !== 1 ? 's' : ''} from this conversation`);
      }
      sessionStorage.setItem('ce_snippets_loaded_toast_shown', 'true');
    }
  }
}

/**
 * Gets snippets for the current conversation, optionally filtered by search query.
 * @returns {Array} Filtered snippets array
 */
function getCurrentConversationSnippets() {
  const currentConvId = getConversationId();
  const url = window.location.href;
  
  // Check if we're on the main page (not in a conversation)
  const isMainPage = !url.includes('/c/') && !url.includes('conversationId=');
  
  let snippets = [];
  
  if (isMainPage) {
    // On main page: show all snippets, unless we are in the middle of a branch transition
    // (ChatGPT sometimes navigates through an intermediate URL before the new /c/{id} appears).
    const pendingBranch =
      !!state.pendingTransferFromConversationId ||
      (!!state.pendingExplicitBranch && (Date.now() - state.pendingExplicitBranch.at) < 15_000);
    snippets = pendingBranch ? [] : state.items;
  } else if (currentConvId) {
    // In a conversation with ID: show only snippets from this conversation
    snippets = state.items.filter(snippet => snippet.conversationId === currentConvId);
  } else {
    // In a conversation view but no ID yet (e.g., new thread): show nothing
    snippets = [];
  }
  
  // Apply search filter if query exists
  if (state.searchQuery && state.searchQuery.trim()) {
    const query = state.searchQuery.toLowerCase().trim();
    snippets = snippets.filter(snippet => 
      snippet.text.toLowerCase().includes(query)
    );
  }
  
  // Sort by timestamp
  snippets.sort((a, b) => {
    const aTime = a.timestamp || 0;
    const bTime = b.timestamp || 0;
    return state.sortOrder === 'desc' ? bTime - aTime : aTime - bTime;
  });
  
  return snippets;
}

/**
 * Watches for conversation changes and updates UI.
 */
function watchConversationChanges() {
  let lastConversationId = getConversationId();
  let lastUrl = window.location.href;
  
  function handleConversationTransition(previousConvId, currentConvId) {
    // Allow multi-step transitions (oldId -> null -> newId) by using pending state.
    const fromConvId = state.pendingTransferFromConversationId || previousConvId;
    if (!fromConvId || fromConvId === currentConvId) return;
    
    // If we're in a conversation view but the ID isn't available yet, defer the offer.
    const url = window.location.href;
    const isMainPage = !url.includes('/c/') && !url.includes('conversationId=');
    if (!isMainPage && !currentConvId) {
      state.pendingTransferFromConversationId = fromConvId;
      // `state.pendingTransferFromMessageHashes` will be set by the caller.
      return;
    }
    
    const toConvId = currentConvId;
    const fromHashes = state.pendingTransferFromMessageHashes || [];
    state.pendingTransferFromConversationId = null;
    state.pendingTransferFromMessageHashes = null;
    
    if (!fromConvId || !toConvId || fromConvId === toConvId) return;
    
    const promptKey = `${fromConvId}->${toConvId}`;
    if (state.lastTransferPromptKey === promptKey) return;
    state.lastTransferPromptKey = promptKey;
    
    const fromSnippets = state.items.filter(s => s.conversationId === fromConvId);
    const toSnippets = state.items.filter(s => s.conversationId === toConvId);
    
    // Only offer when the destination conversation has no snippets yet.
    if (fromSnippets.length === 0 || toSnippets.length > 0) return;
    
    // If the user explicitly clicked "Branch in new chat", skip heuristics for the next navigation.
    const explicit = state.pendingExplicitBranch;
    const now = Date.now();
    const isExplicitBranch =
      !!explicit &&
      explicit.fromConversationId === fromConvId &&
      (now - explicit.at) < 15_000;
    if (isExplicitBranch) {
      state.pendingExplicitBranch = null;
      // Check if there are snippets to copy
      const fromSnippets = state.items.filter(s => s.conversationId === fromConvId);
      if (fromSnippets.length > 0) {
        // Show confirmation prompt
        showBranchCopyPrompt(fromConvId, toConvId, fromSnippets.length).then((shouldCopy) => {
          if (shouldCopy) {
            const copiedCount = copySnippetsToConversation({ fromConversationId: fromConvId, toConversationId: toConvId });
            if (copiedCount > 0) {
              createToast(`Copied ${copiedCount} snippet${copiedCount !== 1 ? 's' : ''} into this thread`);
            }
          }
        });
      }
      return;
    }

    // Branch-only: wait for the new conversation DOM to load, then compare message overlap.
    setTimeout(() => {
      const currentHashes = getConversationMessageHashes(10);
      if (!isLikelyBranch(fromHashes, currentHashes)) {
        return;
      }
      // Heuristic branch detection is best-effort; don't auto-copy without an explicit branch click.
      // (We can add an in-extension prompt here later if desired.)
    }, 700);
  }
  
  // Check periodically for conversation changes
  setInterval(() => {
    const currentUrl = window.location.href;
    const currentConvId = getConversationId();
    
    // Check if URL changed or conversation ID changed
    if (currentUrl !== lastUrl || currentConvId !== lastConversationId) {
      const previousConvId = lastConversationId;
      const previousHashes = getConversationMessageHashes(10);
      lastUrl = currentUrl;
      lastConversationId = currentConvId;
      state.currentConversationId = currentConvId;
      // Clear selections and search when switching conversations
      state.selectedIds.clear();
      state.searchQuery = '';
      updateUI();
      
      // Preserve the "from conversation" across intermediate URLs where the new conversationId isn't available yet.
      if (previousConvId && !currentConvId) {
        state.pendingTransferFromConversationId = previousConvId;
      }
      state.pendingTransferFromMessageHashes = previousHashes;
      handleConversationTransition(previousConvId, currentConvId);
      
      // Most reliable: if the new thread shows "Branched from <link>", use that link as the source of truth.
      if (currentConvId) {
        scheduleBranchedFromTransferCheck();
      }
    }
  }, 500);
  
  // Also listen to popstate for back/forward navigation
  window.addEventListener('popstate', () => {
    const currentConvId = getConversationId();
    if (currentConvId !== lastConversationId) {
      const previousConvId = lastConversationId;
      const previousHashes = getConversationMessageHashes(10);
      lastConversationId = currentConvId;
      state.currentConversationId = currentConvId;
      state.selectedIds.clear();
      state.searchQuery = '';
      updateUI();
      
      if (previousConvId && !currentConvId) {
        state.pendingTransferFromConversationId = previousConvId;
      }
      state.pendingTransferFromMessageHashes = previousHashes;
      handleConversationTransition(previousConvId, currentConvId);
      if (currentConvId) {
        scheduleBranchedFromTransferCheck();
      }
    }
  });
  
  // Listen to pushstate/replacestate (ChatGPT uses these for navigation)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    originalPushState.apply(history, args);
    setTimeout(() => {
      const currentConvId = getConversationId();
      if (currentConvId !== lastConversationId) {
        const previousConvId = lastConversationId;
        const previousHashes = getConversationMessageHashes(10);
        lastConversationId = currentConvId;
        state.currentConversationId = currentConvId;
        state.selectedIds.clear();
        state.searchQuery = '';
        updateUI();
        
        if (previousConvId && !currentConvId) {
          state.pendingTransferFromConversationId = previousConvId;
        }
        state.pendingTransferFromMessageHashes = previousHashes;
        handleConversationTransition(previousConvId, currentConvId);
        if (currentConvId) {
          scheduleBranchedFromTransferCheck();
        }
      }
    }, 100);
  };
  
  history.replaceState = function(...args) {
    originalReplaceState.apply(history, args);
    setTimeout(() => {
      const currentConvId = getConversationId();
      if (currentConvId !== lastConversationId) {
        const previousConvId = lastConversationId;
        const previousHashes = getConversationMessageHashes(10);
        lastConversationId = currentConvId;
        state.currentConversationId = currentConvId;
        state.selectedIds.clear();
        state.searchQuery = '';
        updateUI();
        
        if (previousConvId && !currentConvId) {
          state.pendingTransferFromConversationId = previousConvId;
        }
        state.pendingTransferFromMessageHashes = previousHashes;
        handleConversationTransition(previousConvId, currentConvId);
        if (currentConvId) {
          scheduleBranchedFromTransferCheck();
        }
      }
    }, 100);
  };
}

async function loadState() {
  try {
    const items = await loadSnippets();
    state.items = items;
    
    // Load settings
    const settingsResult = await chrome.storage.local.get('settings');
    if (settingsResult.settings) {
      state.settings = { ...state.settings, ...settingsResult.settings };
    }
  } catch (error) {
    console.error('Failed to load state:', error);
    createToast('Failed to load snippets');
  }
}

async function persistState() {
  try {
    await saveSnippets(state.items);
    // Save settings separately
    await chrome.storage.local.set({ settings: state.settings });
  } catch (error) {
    console.error('Failed to save state:', error);
    createToast('Failed to save snippets');
  }
}

function renderUI() {
  // Get snippets without search filter for count (show total for current conversation)
  const currentConvId = getConversationId();
  const url = window.location.href;
  const isMainPage = !url.includes('/c/') && !url.includes('conversationId=');
  
  let totalSnippets = [];
  if (isMainPage) {
    const pendingBranch =
      !!state.pendingTransferFromConversationId ||
      (!!state.pendingExplicitBranch && (Date.now() - state.pendingExplicitBranch.at) < 15_000);
    totalSnippets = pendingBranch ? [] : state.items;
  } else if (currentConvId) {
    totalSnippets = state.items.filter(snippet => snippet.conversationId === currentConvId);
  } else {
    // In conversation view but no ID yet: show 0
    totalSnippets = [];
  }
  
  // Get filtered snippets for display
  const currentSnippets = getCurrentConversationSnippets();
  
  if (fab && fab.parentNode) {
    fab.parentNode.removeChild(fab);
  }
  // Show total count (not filtered)
  fab = createFAB(totalSnippets.length, togglePanel, handleToggleMinimized);
  container.appendChild(fab);
  if (panel && panel.parentNode) {
    panel.parentNode.removeChild(panel);
  }
  panel = createPanel({
    snippets: currentSnippets,
    onCopy: handleCopy,
    onCopyAll: handleCopyAll,
    onClear: handleClear,
    onClearSelected: handleClearSelected,
    onClose: handleClose,
    onRemove: handleRemove,
    onSnippetClick: handleSnippetClick,
    onCopySnippet: handleCopySnippet,
    onToggleSelect: handleToggleSelect,
    onSelectAll: handleSelectAll,
    onSearch: handleSearch,
    onManage: handleOpenImportExport,
    onToggleTheme: handleToggleTheme,
    onSortToggle: handleSortToggle,
    currentTheme: getCurrentTheme(),
    selectedIds: state.selectedIds,
    searchQuery: state.searchQuery,
    totalCount: totalSnippets.length,
    sortOrder: state.sortOrder
  });
  
  // Apply theme class to panel so it inherits CSS variables
  if (container) {
    const themeClass = Array.from(container.classList).find(cls => cls.startsWith('ce-theme-'));
    if (themeClass) {
      panel.classList.add(themeClass);
    } else {
      // Default to light theme if no theme class found
      panel.classList.add('ce-theme-light');
    }
  } else {
    panel.classList.add('ce-theme-light');
  }
  
  panel.classList.toggle('ce-panel-open', state.panelOpen);
  document.body.appendChild(panel);
  positionPanel(panel);
}

function updateUI() {
  // Get total snippets for count (not filtered, but filtered by conversation)
  const currentConvId = getConversationId();
  const url = window.location.href;
  const isMainPage = !url.includes('/c/') && !url.includes('conversationId=');
  
  let totalSnippets = [];
  if (isMainPage) {
    const pendingBranch =
      !!state.pendingTransferFromConversationId ||
      (!!state.pendingExplicitBranch && (Date.now() - state.pendingExplicitBranch.at) < 15_000);
    totalSnippets = pendingBranch ? [] : state.items;
  } else if (currentConvId) {
    totalSnippets = state.items.filter(snippet => snippet.conversationId === currentConvId);
  } else {
    // In conversation view but no ID yet: show 0
    totalSnippets = [];
  }
  
  // Get filtered snippets for display
  const currentSnippets = getCurrentConversationSnippets();
  
  if (fab) {
    // Always show total count, not filtered count
    updateFABCount(fab, totalSnippets.length);
  }
  if (panel) {
    // Update theme class on panel
    const currentTheme = getCurrentTheme();
    panel.classList.remove('ce-theme-light', 'ce-theme-dark');
    if (currentTheme === 'auto') {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      panel.classList.add(prefersDark ? 'ce-theme-dark' : 'ce-theme-light');
    } else {
      panel.classList.add(`ce-theme-${currentTheme}`);
    }
    
    // Update theme button icon if it exists
    const themeBtn = panel.querySelector('.ce-btn-theme');
    if (themeBtn) {
      const themeIcons = { auto: '🌓', light: '☀', dark: '🌙' };
      const themeLabels = { auto: 'Auto', light: 'Light', dark: 'Dark' };
      themeBtn.innerHTML = themeIcons[currentTheme] || '🌓';
      themeBtn.setAttribute('aria-label', `Theme: ${themeLabels[currentTheme] || 'Auto'}`);
      themeBtn.title = `Theme: ${themeLabels[currentTheme] || 'Auto'} (click to change)`;
    }
    
    updatePanel(panel, currentSnippets, handleRemove, handleSnippetClick, handleCopySnippet, handleToggleSelect, handleSelectAll, handleSearch, state.selectedIds, state.searchQuery, totalSnippets.length, state.sortOrder, handleSortToggle, handleClearSelected, handleToggleTheme);
  }
}

function setupEventListeners() {
  document.addEventListener('mouseup', handleSelection);
  document.addEventListener('mousedown', (e) => {
    // Hide toolbar when clicking outside
    if (selectionToolbar && !selectionToolbar.contains(e.target) && !fab.contains(e.target)) {
      hideSelectionToolbar();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modalOpen) {
        handleCloseImportExport();
        return;
      }
      if (state.panelOpen) {
        handleClose();
      }
      hideSelectionToolbar();
    }
  });
  document.addEventListener('click', (e) => {
    if (modalOpen) return;
    if (state.panelOpen && panel && !panel.contains(e.target) && !fab.contains(e.target)) {
      handleClose();
    }
  });
  // Hide toolbar on scroll
  document.addEventListener('scroll', () => {
    hideSelectionToolbar();
  }, true);
  window.addEventListener('resize', () => {
    if (panel) {
      positionPanel(panel);
    }
  });
}

function handleSelection(e) {
  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideSelectionToolbar();
      return;
    }
    
    // Don't show toolbar if clicking in extension UI
    if (container && container.contains(e.target)) {
      hideSelectionToolbar();
      return;
    }
    
    // Don't show toolbar if selection is in extension UI
    const range = selection.getRangeAt(0);
    const containerEl = range.commonAncestorContainer;
    const element = containerEl.nodeType === Node.ELEMENT_NODE 
      ? containerEl 
      : containerEl.parentElement;
    
    if (element) {
      let current = element;
      while (current && current !== document.body) {
        if (current.id === CONTAINER_ID || current.classList?.contains('ce-extension')) {
          hideSelectionToolbar();
          return;
        }
        current = current.parentElement;
      }
    }
    
    // Show selection toolbar near FAB
    createSelectionToolbar(selection, range);
  }, 10);
}

function addSnippet(snippet) {
  state.items.push(snippet);
  updateUI();
  persistState();
}

async function handleRemove(id) {
  // Find the snippet to show preview
  const snippet = state.items.find(item => item.id === id);
  if (!snippet) return;
  
  // Get first two lines of snippet text
  const lines = snippet.text.split('\n').filter(line => line.trim());
  const preview = lines.slice(0, 2).join('\n');
  const previewText = preview.length > 100 ? preview.substring(0, 100) + '...' : preview;
  
  const ok = await showConfirmModal({
    title: 'Remove snippet?',
    message: previewText ? `Remove this snippet?\n\n"${previewText}"\n\nThis will remove it from your collected list. You cannot undo this.` : 'This will remove it from your collected list. You cannot undo this.',
    confirmText: 'Remove',
    cancelText: 'Cancel',
    danger: true
  });
  if (!ok) return;
  state.items = state.items.filter(item => item.id !== id);
  state.selectedIds.delete(id); // Remove from selection if it was selected
  updateUI();
  persistState();
  createToast('Snippet removed');
}

async function handleClear() {
  const currentSnippets = getCurrentConversationSnippets();
  if (currentSnippets.length === 0) return;
  
  const currentConvId = getConversationId();
  const ok = await showConfirmModal({
    title: 'Clear collected snippets?',
    message: `Clear all ${currentSnippets.length} snippet${currentSnippets.length !== 1 ? 's' : ''} from this conversation?`,
    confirmText: 'Clear',
    cancelText: 'Cancel',
    danger: true
  });
  if (!ok) return;
  
  if (currentConvId) {
    // Remove only snippets from current conversation
    state.items = state.items.filter(snippet => snippet.conversationId !== currentConvId);
  } else {
    // No conversation ID, clear all
    state.items = [];
  }
  // Remove cleared snippets from selection
  currentSnippets.forEach(snippet => state.selectedIds.delete(snippet.id));
  updateUI();
  persistState();
  createToast(`Cleared ${currentSnippets.length} snippet${currentSnippets.length !== 1 ? 's' : ''}`);
}

async function handleClearSelected() {
  if (state.selectedIds.size === 0) return;
  
  const selectedSnippets = state.items.filter(snippet => state.selectedIds.has(snippet.id));
  if (selectedSnippets.length === 0) return;
  
  const ok = await showConfirmModal({
    title: 'Clear selected snippets?',
    message: `Clear ${selectedSnippets.length} selected snippet${selectedSnippets.length !== 1 ? 's' : ''}?`,
    confirmText: 'Clear',
    cancelText: 'Cancel',
    danger: true
  });
  if (!ok) return;
  
  // Remove selected snippets
  state.items = state.items.filter(snippet => !state.selectedIds.has(snippet.id));
  state.selectedIds.clear();
  updateUI();
  persistState();
  createToast(`Cleared ${selectedSnippets.length} snippet${selectedSnippets.length !== 1 ? 's' : ''}`);
}

function showCopyIndicator(button, originalText) {
  if (!button) return;
  
  button.classList.add('ce-btn-copied');
  const originalContent = button.innerHTML;
  button.innerHTML = '✓ ' + (originalText || 'Copied');
  
  setTimeout(() => {
    button.classList.remove('ce-btn-copied');
    button.innerHTML = originalContent;
  }, 2500);
}

async function handleCopy() {
  // Get visible (filtered) snippets
  const visibleSnippets = getCurrentConversationSnippets();
  
  if (visibleSnippets.length === 0) {
    createToast('No snippets to copy');
    return;
  }
  
  // Get snippets to copy:
  // - If any are selected, copy only the selected ones that are visible (filter takes precedence)
  // - Otherwise, copy all visible (filtered) snippets
  let snippetsToCopy = [];
  if (state.selectedIds.size > 0) {
    // Filter takes precedence: only copy selected snippets that are also visible
    snippetsToCopy = visibleSnippets.filter(snippet => state.selectedIds.has(snippet.id));
  } else {
    // No selection - copy all visible (filtered) snippets
    snippetsToCopy = visibleSnippets;
  }
  
  if (snippetsToCopy.length === 0) {
    createToast('No selected snippets visible');
    return;
  }
  
  // Format snippets as markdown with cleanup
  const markdown = snippetsToCopy
    .map((snippet) => {
      // Clean up each snippet's markdown
      const cleaned = cleanupMarkdown(snippet.text);
      return cleaned;
    })
    .join('\n\n');
  
  // Apply final cleanup to the entire output
  const finalMarkdown = cleanupMarkdown(markdown);
  
  try {
    await navigator.clipboard.writeText(finalMarkdown);
    const count = snippetsToCopy.length;
    createToast(`Copied ${count} snippet${count !== 1 ? 's' : ''} to clipboard`);
    
    // Show indicator on Copy Selected button
    if (panel) {
      const copyBtn = panel.querySelector('.ce-btn-copy-selected');
      if (copyBtn) {
        showCopyIndicator(copyBtn, copyBtn.innerHTML);
      }
    }
  } catch (error) {
    console.error('Failed to copy:', error);
    createToast('Failed to copy to clipboard');
  }
}

async function handleCopyAll() {
  // Get visible (filtered) snippets
  const visibleSnippets = getCurrentConversationSnippets();
  
  if (visibleSnippets.length === 0) {
    createToast('No snippets to copy');
    return;
  }
  
  // Always copy all visible snippets, regardless of selection
  const snippetsToCopy = visibleSnippets;
  
  // Format snippets as markdown with cleanup
  const markdown = snippetsToCopy
    .map((snippet) => {
      // Clean up each snippet's markdown
      const cleaned = cleanupMarkdown(snippet.text);
      return cleaned;
    })
    .join('\n\n');
  
  // Apply final cleanup to the entire output
  const finalMarkdown = cleanupMarkdown(markdown);
  
  try {
    await navigator.clipboard.writeText(finalMarkdown);
    const count = snippetsToCopy.length;
    createToast(`Copied ${count} snippet${count !== 1 ? 's' : ''} to clipboard`);
    
    // Show indicator on Copy All button
    if (panel) {
      const copyAllBtn = panel.querySelector('.ce-btn-copy-all');
      if (copyAllBtn) {
        showCopyIndicator(copyAllBtn, copyAllBtn.innerHTML);
      }
    }
  } catch (error) {
    console.error('Failed to copy:', error);
    createToast('Failed to copy to clipboard');
  }
}

function handleOpenImportExport() {
  if (modalOpen) return;
  importExportModal = createImportExportModal({
    snippetCount: state.items.length,
    onClose: handleCloseImportExport,
    onExportJson: handleExportJson,
    onExportMarkdown: handleExportMarkdown,
    onPreview: handlePreviewImport,
    onConfirm: handleConfirmImport
  });
  document.body.appendChild(importExportModal);
  modalOpen = true;
}

function handleCloseImportExport() {
  if (!importExportModal) return;
  importExportModal.remove();
  importExportModal = null;
  modalOpen = false;
}

function handleExportJson() {
  if (state.items.length === 0) {
    createToast('No snippets to export');
    return;
  }
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    items: state.items
  };
  downloadTextFile(exportFilename('json'), JSON.stringify(payload, null, 2), 'application/json');
  createToast(`Exported ${state.items.length} snippet${state.items.length !== 1 ? 's' : ''}`);
}

function handleExportMarkdown() {
  if (state.items.length === 0) {
    createToast('No snippets to export');
    return;
  }
  const markdown = buildMarkdownFromSnippets(state.items);
  downloadTextFile(exportFilename('md'), markdown, 'text/markdown');
  createToast(`Exported ${state.items.length} snippet${state.items.length !== 1 ? 's' : ''}`);
}

async function handlePreviewImport(file, mode, setStatus, setPreview, setPending) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(items)) {
      setStatus('Invalid JSON format.', 'error');
      setPreview('Preview unavailable.', 'error');
      setPending(null);
      return;
    }
    const normalized = normalizeImportedSnippets(items);
    if (normalized.length === 0) {
      setStatus('No valid snippets found.', 'error');
      setPreview('Preview unavailable.', 'error');
      setPending(null);
      return;
    }
    const { items: expanded, duplicates } = expandImportDuplicates(normalized);
    if (mode === 'replace') {
      const preview = `Preview: ${expanded.length} snippet${expanded.length !== 1 ? 's' : ''} will replace ${state.items.length}.` +
        (duplicates ? ` ${duplicates} duplicate${duplicates !== 1 ? 's' : ''} in file will be labeled.` : '');
      setStatus('Preview ready.', 'success');
      setPreview(preview, 'success');
      setPending({ items: expanded });
      return;
    }
    const { items: merged, added, skipped } = mergeSnippets(state.items, expanded);
    const preview = `Preview: add ${added} new, skip ${skipped} duplicate${skipped !== 1 ? 's' : ''}.` +
      ` Total after import: ${merged.length}.` +
      (duplicates ? ` ${duplicates} duplicate${duplicates !== 1 ? 's' : ''} in file will be labeled.` : '');
    setStatus('Preview ready.', 'success');
    setPreview(preview, 'success');
    setPending({ items: expanded });
  } catch (error) {
    console.error('Failed to import snippets:', error);
    setStatus('Failed to read import file.', 'error');
    setPreview('Preview unavailable.', 'error');
    setPending(null);
  }
}

async function handleConfirmImport(pending, mode, setStatus, setPreview, setPending) {
  try {
    if (!pending?.items) {
      setStatus('No preview data available.', 'error');
      return;
    }
    if (mode === 'replace') {
      state.items = pending.items;
      state.selectedIds.clear();
      state.searchQuery = '';
      updateUI();
      await persistState();
      setStatus(`Imported ${pending.items.length} snippet${pending.items.length !== 1 ? 's' : ''}.`, 'success');
      setPreview('Import complete. You can select another file to import.', 'success');
      setPending(null);
      return;
    }
    const { items: merged, added, skipped } = mergeSnippets(state.items, pending.items);
    state.items = merged;
    updateUI();
    await persistState();
    const suffix = skipped ? ` (${skipped} duplicates skipped)` : '';
    setStatus(`Imported ${added} new snippet${added !== 1 ? 's' : ''}${suffix}.`, 'success');
    setPreview('Import complete. You can select another file to import.', 'success');
    setPending(null);
  } catch (error) {
    console.error('Failed to import snippets:', error);
    setStatus('Failed to import snippets.', 'error');
  }
}

function handleToggleSelect(snippetId) {
  if (state.selectedIds.has(snippetId)) {
    state.selectedIds.delete(snippetId);
  } else {
    state.selectedIds.add(snippetId);
  }
  updateUI();
}

function handleSelectAll() {
  const currentSnippets = getCurrentConversationSnippets();
  if (currentSnippets.length === 0) return;
  
  const currentSnippetIds = new Set(currentSnippets.map(item => item.id));
  const allSelected = currentSnippetIds.size > 0 && 
                      Array.from(currentSnippetIds).every(id => state.selectedIds.has(id));
  
  if (allSelected) {
    // Deselect all current conversation snippets
    currentSnippetIds.forEach(id => {
      state.selectedIds.delete(id);
    });
  } else {
    // Select all current conversation snippets
    currentSnippetIds.forEach(id => {
      state.selectedIds.add(id);
    });
  }
  updateUI();
}

function handleSearch(query) {
  state.searchQuery = query;
  // Clear selections when searching (optional - you might want to keep them)
  // state.selectedIds.clear();
  updateUI();
}

function handleSortToggle() {
  state.sortOrder = state.sortOrder === 'desc' ? 'asc' : 'desc';
  updateUI();
}

async function handleCopySnippet(snippet) {
  try {
    // Clean up the snippet's markdown
    const cleaned = cleanupMarkdown(snippet.text);
    await navigator.clipboard.writeText(cleaned);
    createToast('Copied to clipboard');
    
    // Show indicator on snippet's copy button
    if (panel) {
      const snippetItem = panel.querySelector(`[data-snippet-id="${snippet.id}"]`);
      if (snippetItem) {
        const copyBtn = snippetItem.querySelector('.ce-btn-copy');
        if (copyBtn) {
          showCopyIndicator(copyBtn, '');
        }
      }
    }
  } catch (error) {
    console.error('Failed to copy:', error);
    createToast('Failed to copy to clipboard');
  }
}

function handleSnippetClick(snippet) {
  const success = navigateToSource(snippet);
  if (!success) {
    createToast('Source not found');
  }
}

function togglePanel() {
  state.panelOpen = !state.panelOpen;
  if (panel) {
    panel.classList.toggle('ce-panel-open', state.panelOpen);
    if (state.panelOpen) {
      positionPanel(panel);
    }
  }
  // Hide selection toolbar when opening/closing panel
  hideSelectionToolbar();
}

function handleClose() {
  state.panelOpen = false;
  // Clear search when closing panel
  state.searchQuery = '';
  if (panel) {
    panel.classList.remove('ce-panel-open');
  }
  // Update UI to show correct count
  updateUI();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
