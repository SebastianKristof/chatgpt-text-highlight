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

function applyTransientHighlight(element, startOffset, endOffset) {
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

function navigateToSource(snippet) {
  if (!snippet || !snippet.anchor) {
    return false;
  }
  const { anchor } = snippet;
  
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
    // offer to open the original source conversation.
    if (anchor.conversationId && (!currentConversationId || currentConversationId !== anchor.conversationId)) {
      const conversationUrl = `https://chatgpt.com/c/${anchor.conversationId}`;
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
    createToast('Source not found');
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
        case 'pre':
          const codeElement = node.querySelector('code');
          const codeText = codeElement ? codeElement.textContent : node.textContent;
          markdown += '\n```\n' + codeText.trim() + '\n```\n';
          break;
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
        case 'ol':
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
        case 'li':
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
        case 'blockquote':
          const lines = text.split('\n').filter(l => l.trim());
          if (lines.length > 0) {
            markdown += lines.map(l => `> ${l.trim()}`).join('\n') + '\n\n';
          }
          break;
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

function createContainer() {
  let container = document.getElementById(CONTAINER_ID);
  if (container) return container;
  container = document.createElement('div');
  container.id = CONTAINER_ID;
  container.className = 'ce-extension';
  document.body.appendChild(container);
  return container;
}

function createFAB(count, onClick) {
  const fab = document.createElement('button');
  fab.className = 'ce-fab';
  fab.setAttribute('aria-label', `Collected snippets: ${count}`);
  fab.innerHTML = `
    <span class="ce-fab-text">Collected</span>
    <span class="ce-fab-count">${count}</span>
  `;
  fab.addEventListener('click', onClick);
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
  const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  meta.textContent = timeStr;
  
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
  removeBtn.className = 'ce-btn ce-btn-icon ce-btn-small';
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
  snippets.forEach((snippet, index) => {
    const isSelected = selectedIds && selectedIds.has(snippet.id);
    const item = createSnippetItem(snippet, index, onRemove, onSnippetClick, onCopySnippet, onToggleSelect, isSelected);
    list.appendChild(item);
  });
  return list;
}

function createPanelHeader({ onCopy, onClear, onClose, onSelectAll, onSearch, snippetCount, selectedCount, allSelected, searchQuery }) {
  const header = document.createElement('div');
  header.className = 'ce-panel-header';
  const title = document.createElement('h2');
  title.className = 'ce-panel-title';
  title.textContent = 'Collected Snippets';
  
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
  
  const actions = document.createElement('div');
  actions.className = 'ce-panel-actions';
  
  const selectAllBtn = document.createElement('button');
  selectAllBtn.className = 'ce-btn';
  selectAllBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
  selectAllBtn.setAttribute('aria-label', allSelected ? 'Deselect all snippets' : 'Select all snippets');
  selectAllBtn.addEventListener('click', onSelectAll);
  selectAllBtn.disabled = snippetCount === 0;
  
  const copyBtn = document.createElement('button');
  copyBtn.className = 'ce-btn ce-btn-secondary';
  if (selectedCount > 0) {
    copyBtn.textContent = `Copy (${selectedCount})`;
    copyBtn.setAttribute('aria-label', `Copy ${selectedCount} selected snippets`);
  } else {
    copyBtn.textContent = 'Copy All';
    copyBtn.setAttribute('aria-label', 'Copy all snippets');
  }
  copyBtn.addEventListener('click', onCopy);
  copyBtn.disabled = snippetCount === 0;
  
  const clearBtn = document.createElement('button');
  clearBtn.className = 'ce-btn ce-btn-secondary';
  clearBtn.textContent = 'Clear';
  clearBtn.setAttribute('aria-label', 'Clear all snippets');
  clearBtn.addEventListener('click', async () => {
    await onClear();
  });
  clearBtn.disabled = snippetCount === 0;
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ce-btn ce-btn-icon';
  closeBtn.setAttribute('aria-label', 'Close panel');
  closeBtn.innerHTML = '×';
  closeBtn.addEventListener('click', onClose);
  
  actions.appendChild(selectAllBtn);
  actions.appendChild(copyBtn);
  actions.appendChild(clearBtn);
  actions.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(searchContainer);
  header.appendChild(actions);
  return header;
}

function createPanelFooter() {
  const footer = document.createElement('div');
  footer.className = 'ce-panel-footer';
  footer.textContent = 'Click a snippet to navigate to its source';
  return footer;
}

function createPanel({ snippets, onCopy, onClear, onClose, onRemove, onSnippetClick, onCopySnippet, onToggleSelect, onSelectAll, onSearch, selectedIds, searchQuery }) {
  const panel = document.createElement('div');
  panel.className = 'ce-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Collected snippets');
  const allSelected = selectedIds && selectedIds.size === snippets.length && snippets.length > 0;
  const header = createPanelHeader({ 
    onCopy, 
    onClear, 
    onClose, 
    onSelectAll,
    onSearch,
    snippetCount: snippets.length, 
    selectedCount: selectedIds ? selectedIds.size : 0,
    allSelected,
    searchQuery
  });
  const list = createSnippetList({ snippets, onRemove, onSnippetClick, onCopySnippet, onToggleSelect, selectedIds });
  const footer = createPanelFooter();
  panel.appendChild(header);
  panel.appendChild(list);
  panel.appendChild(footer);
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
    p.textContent = message || '';
    
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

let selectionToolbar = null;

function createSelectionToolbar(selection, range) {
  // Remove existing toolbar
  if (selectionToolbar) {
    hideSelectionToolbar();
  }
  
  // Create elegant toolbar near the FAB
  const toolbar = document.createElement('div');
  toolbar.className = 'ce-selection-toolbar';
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
  
  const container = document.getElementById(CONTAINER_ID) || createContainer();
  container.appendChild(toolbar);
  selectionToolbar = toolbar;
  
  // Position relative to FAB
  if (fab) {
    const fabRect = fab.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    toolbar.style.left = `${fabRect.left - containerRect.left - toolbar.offsetWidth - 12}px`;
    toolbar.style.top = `${fabRect.top - containerRect.top}px`;
  }
  
  // Animate in
  requestAnimationFrame(() => {
    toolbar.classList.add('ce-toolbar-show');
  });
}

function hideSelectionToolbar() {
  if (selectionToolbar) {
    selectionToolbar.classList.remove('ce-toolbar-show');
    setTimeout(() => {
      if (selectionToolbar && selectionToolbar.parentNode) {
        selectionToolbar.parentNode.removeChild(selectionToolbar);
      }
      selectionToolbar = null;
    }, 200);
  }
}

function updateFABCount(fab, count) {
  const countEl = fab.querySelector('.ce-fab-count');
  if (countEl) {
    countEl.textContent = count;
  }
  fab.setAttribute('aria-label', `Collected snippets: ${count}`);
}

function updatePanel(panel, snippets, onRemove, onSnippetClick, onCopySnippet, onToggleSelect, onSelectAll, onSearch, selectedIds, searchQuery) {
  const list = panel.querySelector('.ce-snippet-list');
  if (!list) return;
  list.innerHTML = '';
  if (snippets.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'ce-empty-state';
    if (searchQuery && searchQuery.trim()) {
      emptyState.textContent = 'No snippets match your search';
    } else {
      emptyState.textContent = 'Select text to save a snippet';
    }
    list.appendChild(emptyState);
  } else {
    snippets.forEach((snippet, index) => {
      const isSelected = selectedIds && selectedIds.has(snippet.id);
      const item = createSnippetItem(snippet, index, onRemove, onSnippetClick, onCopySnippet, onToggleSelect, isSelected);
      list.appendChild(item);
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
  
  // Update header buttons
  const selectAllBtn = panel.querySelector('.ce-btn:not(.ce-btn-secondary):not(.ce-btn-icon)');
  const copyBtn = panel.querySelector('.ce-btn-secondary');
  const clearBtn = panel.querySelector('.ce-btn[aria-label="Clear all snippets"]');
  
  if (selectAllBtn) {
    const allSelected = selectedIds && selectedIds.size === snippets.length && snippets.length > 0;
    selectAllBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
    selectAllBtn.setAttribute('aria-label', allSelected ? 'Deselect all snippets' : 'Select all snippets');
    selectAllBtn.disabled = snippets.length === 0;
    // Update click handler
    selectAllBtn.onclick = onSelectAll;
  }
  
  if (copyBtn) {
    const selectedCount = selectedIds ? selectedIds.size : 0;
    if (selectedCount > 0) {
      copyBtn.textContent = `Copy (${selectedCount})`;
      copyBtn.setAttribute('aria-label', `Copy ${selectedCount} selected snippets`);
    } else {
      copyBtn.textContent = 'Copy All';
      copyBtn.setAttribute('aria-label', 'Copy all snippets');
    }
    copyBtn.disabled = snippets.length === 0;
  }
  if (clearBtn) clearBtn.disabled = snippets.length === 0;
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
  // When ChatGPT navigates to a new thread, it can take a moment for the URL to include the new conversationId.
  // We track the previous conversation so we can offer to copy snippets forward once the new ID exists.
  pendingTransferFromConversationId: null,
  pendingTransferFromMessageHashes: null,
  // Set when the user explicitly clicks ChatGPT's "Branch in new chat" menu item.
  // Used to avoid heuristics when we *know* the next navigation is a branch.
  pendingExplicitBranch: null,
  lastAutoTransferKey: null,
  lastTransferPromptKey: null
};

let container = null;
let fab = null;
let panel = null;

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
    
    const copiedCount = copySnippetsToConversation({ fromConversationId: fromId, toConversationId: toConvId });
    if (copiedCount > 0) {
      createToast(`Copied ${copiedCount} snippet${copiedCount !== 1 ? 's' : ''} from parent thread`);
    }
    clearInterval(interval);
  }, 500);
}

async function init() {
  container = createContainer();
  await loadState();
  state.currentConversationId = getConversationId();
  renderUI();
  setupEventListeners();
  // Prefer click-capture (no reliance on ephemeral IDs). Observer remains as a secondary path.
  installBranchInNewChatClickCapture();
  installBranchInNewChatObserver();
  
  // Watch for conversation changes
  watchConversationChanges();
  
  const currentSnippets = getCurrentConversationSnippets();
  if (currentSnippets.length > 0) {
    createToast(`Loaded ${currentSnippets.length} snippet${currentSnippets.length !== 1 ? 's' : ''} from this conversation`);
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
      // Avoid `confirm()` here: it can be blocked because this runs on navigation timers, not a direct user gesture.
      const copiedCount = copySnippetsToConversation({ fromConversationId: fromConvId, toConversationId: toConvId });
      if (copiedCount > 0) {
        createToast(`Copied ${copiedCount} snippet${copiedCount !== 1 ? 's' : ''} into this thread`);
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
  } catch (error) {
    console.error('Failed to load state:', error);
    createToast('Failed to load snippets');
  }
}

async function persistState() {
  try {
    await saveSnippets(state.items);
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
  fab = createFAB(totalSnippets.length, togglePanel);
  container.appendChild(fab);
  if (panel && panel.parentNode) {
    panel.parentNode.removeChild(panel);
  }
  panel = createPanel({
    snippets: currentSnippets,
    onCopy: handleCopy,
    onClear: handleClear,
    onClose: handleClose,
    onRemove: handleRemove,
    onSnippetClick: handleSnippetClick,
    onCopySnippet: handleCopySnippet,
    onToggleSelect: handleToggleSelect,
    onSelectAll: handleSelectAll,
    onSearch: handleSearch,
    selectedIds: state.selectedIds,
    searchQuery: state.searchQuery
  });
  panel.classList.toggle('ce-panel-open', state.panelOpen);
  container.appendChild(panel);
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
    updatePanel(panel, currentSnippets, handleRemove, handleSnippetClick, handleCopySnippet, handleToggleSelect, handleSelectAll, handleSearch, state.selectedIds, state.searchQuery);
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
      if (state.panelOpen) {
        handleClose();
      }
      hideSelectionToolbar();
    }
  });
  document.addEventListener('click', (e) => {
    if (state.panelOpen && panel && !panel.contains(e.target) && !fab.contains(e.target)) {
      handleClose();
    }
  });
  // Hide toolbar on scroll
  document.addEventListener('scroll', () => {
    hideSelectionToolbar();
  }, true);
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
  const ok = await showConfirmModal({
    title: 'Remove snippet?',
    message: 'This will remove it from your collected list. You can’t undo this.',
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
  } catch (error) {
    console.error('Failed to copy:', error);
    createToast('Failed to copy to clipboard');
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
  const currentSnippetIds = new Set(currentSnippets.map(item => item.id));
  const allSelected = currentSnippetIds.size > 0 && 
                      Array.from(currentSnippetIds).every(id => state.selectedIds.has(id));
  
  if (allSelected) {
    // Deselect all current conversation snippets
    currentSnippetIds.forEach(id => state.selectedIds.delete(id));
  } else {
    // Select all current conversation snippets
    currentSnippetIds.forEach(id => state.selectedIds.add(id));
  }
  updateUI();
}

function handleSearch(query) {
  state.searchQuery = query;
  // Clear selections when searching (optional - you might want to keep them)
  // state.selectedIds.clear();
  updateUI();
}

async function handleCopySnippet(snippet) {
  try {
    // Clean up the snippet's markdown
    const cleaned = cleanupMarkdown(snippet.text);
    await navigator.clipboard.writeText(cleaned);
    createToast('Copied to clipboard');
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
