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
  const url = window.location.href;
  const match1 = url.match(/\/c\/([a-f0-9-]+)/);
  if (match1) return match1[1];
  const match2 = url.match(/[?&]conversationId=([^&]+)/);
  if (match2) return match2[1];
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
  const selectionText = getSelectionText();
  if (!selectionText) return null;
  let finalText = selectionText;
  let truncated = false;
  if (finalText.length > MAX_SELECTION_SIZE) {
    finalText = finalText.substring(0, MAX_SELECTION_SIZE);
    truncated = true;
  }
  const range = selection.getRangeAt(0);
  const startNode = range.startContainer;
  const messageBlock = findMessageBlock(startNode);
  if (!messageBlock) {
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
  const offsets = findSelectionOffsets(messageText, finalText);
  const selectionStart = offsets?.start ?? 0;
  const selectionEnd = offsets?.end ?? finalText.length;
  const anchor = buildAnchor({
    conversationId,
    messageId,
    messageText,
    selectionText: finalText,
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
  const text = (element.innerText || element.textContent || '').trim();
  const normalizedText = text.replace(/\s+/g, ' ');
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  let currentOffset = 0;
  let startNode = null;
  let endNode = null;
  let startNodeOffset = 0;
  let endNodeOffset = 0;
  let node;
  while (node = walker.nextNode()) {
    const nodeText = node.textContent || '';
    const normalizedNodeText = nodeText.replace(/\s+/g, ' ');
    const nodeLength = normalizedNodeText.length;
    if (!startNode && currentOffset + nodeLength >= startOffset) {
      startNode = node;
      startNodeOffset = startOffset - currentOffset;
    }
    if (currentOffset + nodeLength >= endOffset) {
      endNode = node;
      endNodeOffset = endOffset - currentOffset;
      break;
    }
    currentOffset += nodeLength;
  }
  if (!startNode || !endNode) {
    element.classList.add('ce-highlight-transient');
    setTimeout(() => {
      element.classList.remove('ce-highlight-transient');
    }, HIGHLIGHT_DURATION);
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  try {
    const range = document.createRange();
    range.setStart(startNode, Math.min(startNodeOffset, startNode.textContent.length));
    range.setEnd(endNode, Math.min(endNodeOffset, endNode.textContent.length));
    const highlight = document.createElement('span');
    highlight.className = 'ce-highlight-transient';
    highlight.textContent = range.toString();
    range.deleteContents();
    range.insertNode(highlight);
    highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      if (highlight.parentNode) {
        highlight.parentNode.replaceChild(document.createTextNode(highlight.textContent), highlight);
        highlight.parentNode.normalize();
      }
    }, HIGHLIGHT_DURATION);
  } catch (error) {
    console.warn('Failed to create precise highlight, using element highlight:', error);
    element.classList.add('ce-highlight-transient');
    setTimeout(() => {
      element.classList.remove('ce-highlight-transient');
    }, HIGHLIGHT_DURATION);
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function navigateToSource(snippet) {
  if (!snippet || !snippet.anchor) {
    return false;
  }
  const { anchor } = snippet;
  if (anchor.conversationId) {
    const currentConversationId = getConversationId();
    if (currentConversationId && currentConversationId !== anchor.conversationId) {
      return false;
    }
  }
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
    return false;
  }
  if (anchor.selectionOffsets) {
    applyTransientHighlight(
      messageBlock,
      anchor.selectionOffsets.start,
      anchor.selectionOffsets.end
    );
  } else {
    messageBlock.classList.add('ce-highlight-transient');
    setTimeout(() => {
      messageBlock.classList.remove('ce-highlight-transient');
    }, HIGHLIGHT_DURATION);
    messageBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return true;
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

function createSnippetItem(snippet, index, onRemove, onSnippetClick) {
  const item = document.createElement('div');
  item.className = 'ce-snippet-item';
  item.setAttribute('data-snippet-id', snippet.id);
  const text = document.createElement('div');
  text.className = 'ce-snippet-text';
  text.textContent = snippet.text;
  text.setAttribute('title', snippet.text);
  text.style.cursor = 'pointer';
  text.addEventListener('click', () => onSnippetClick(snippet));
  const meta = document.createElement('div');
  meta.className = 'ce-snippet-meta';
  const timestamp = new Date(snippet.timestamp);
  const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  meta.textContent = timeStr;
  const removeBtn = document.createElement('button');
  removeBtn.className = 'ce-btn ce-btn-icon ce-btn-small';
  removeBtn.setAttribute('aria-label', 'Remove snippet');
  removeBtn.innerHTML = '×';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onRemove(snippet.id);
  });
  item.appendChild(text);
  item.appendChild(meta);
  item.appendChild(removeBtn);
  return item;
}

function createSnippetList({ snippets, onRemove, onSnippetClick }) {
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
    const item = createSnippetItem(snippet, index, onRemove, onSnippetClick);
    list.appendChild(item);
  });
  return list;
}

function createPanelHeader({ onCopy, onClear, onClose, snippetCount }) {
  const header = document.createElement('div');
  header.className = 'ce-panel-header';
  const title = document.createElement('h2');
  title.className = 'ce-panel-title';
  title.textContent = 'Collected Snippets';
  const actions = document.createElement('div');
  actions.className = 'ce-panel-actions';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'ce-btn ce-btn-secondary';
  copyBtn.textContent = 'Copy';
  copyBtn.setAttribute('aria-label', 'Copy all snippets');
  copyBtn.addEventListener('click', onCopy);
  copyBtn.disabled = snippetCount === 0;
  const clearBtn = document.createElement('button');
  clearBtn.className = 'ce-btn ce-btn-secondary';
  clearBtn.textContent = 'Clear';
  clearBtn.setAttribute('aria-label', 'Clear all snippets');
  clearBtn.addEventListener('click', onClear);
  clearBtn.disabled = snippetCount === 0;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ce-btn ce-btn-icon';
  closeBtn.setAttribute('aria-label', 'Close panel');
  closeBtn.innerHTML = '×';
  closeBtn.addEventListener('click', onClose);
  actions.appendChild(copyBtn);
  actions.appendChild(clearBtn);
  actions.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(actions);
  return header;
}

function createPanelFooter() {
  const footer = document.createElement('div');
  footer.className = 'ce-panel-footer';
  footer.textContent = 'Click a snippet to navigate to its source';
  return footer;
}

function createPanel({ snippets, onCopy, onClear, onClose, onRemove, onSnippetClick }) {
  const panel = document.createElement('div');
  panel.className = 'ce-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Collected snippets');
  const header = createPanelHeader({ onCopy, onClear, onClose, snippetCount: snippets.length });
  const list = createSnippetList({ snippets, onRemove, onSnippetClick });
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

function updateFABCount(fab, count) {
  const countEl = fab.querySelector('.ce-fab-count');
  if (countEl) {
    countEl.textContent = count;
  }
  fab.setAttribute('aria-label', `Collected snippets: ${count}`);
}

function updatePanel(panel, snippets, onRemove, onSnippetClick) {
  const list = panel.querySelector('.ce-snippet-list');
  if (!list) return;
  list.innerHTML = '';
  if (snippets.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'ce-empty-state';
    emptyState.textContent = 'Select text to save a snippet';
    list.appendChild(emptyState);
  } else {
    snippets.forEach((snippet, index) => {
      const item = createSnippetItem(snippet, index, onRemove, onSnippetClick);
      list.appendChild(item);
    });
  }
  const copyBtn = panel.querySelector('.ce-btn[aria-label="Copy all snippets"]');
  const clearBtn = panel.querySelector('.ce-btn[aria-label="Clear all snippets"]');
  if (copyBtn) copyBtn.disabled = snippets.length === 0;
  if (clearBtn) clearBtn.disabled = snippets.length === 0;
}

// ============================================================================
// Main Content Script
// ============================================================================

let state = {
  items: [],
  panelOpen: false
};

let container = null;
let fab = null;
let panel = null;

async function init() {
  container = createContainer();
  await loadState();
  renderUI();
  setupEventListeners();
  if (state.items.length > 0) {
    createToast(`Loaded ${state.items.length} snippet${state.items.length !== 1 ? 's' : ''}`);
  }
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
  if (fab && fab.parentNode) {
    fab.parentNode.removeChild(fab);
  }
  fab = createFAB(state.items.length, togglePanel);
  container.appendChild(fab);
  if (panel && panel.parentNode) {
    panel.parentNode.removeChild(panel);
  }
  panel = createPanel({
    snippets: state.items,
    onCopy: handleCopy,
    onClear: handleClear,
    onClose: handleClose,
    onRemove: handleRemove,
    onSnippetClick: handleSnippetClick
  });
  panel.classList.toggle('ce-panel-open', state.panelOpen);
  container.appendChild(panel);
}

function updateUI() {
  if (fab) {
    updateFABCount(fab, state.items.length);
  }
  if (panel) {
    updatePanel(panel, state.items, handleRemove, handleSnippetClick);
  }
}

function setupEventListeners() {
  document.addEventListener('mouseup', handleSelection);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.panelOpen) {
      handleClose();
    }
  });
  document.addEventListener('click', (e) => {
    if (state.panelOpen && panel && !panel.contains(e.target) && !fab.contains(e.target)) {
      handleClose();
    }
  });
}

function handleSelection(e) {
  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }
    if (container && container.contains(e.target)) {
      return;
    }
    const snippet = buildSnippetFromSelection();
    if (snippet) {
      addSnippet(snippet);
      if (snippet.truncated) {
        createToast('Snippet truncated (max 10,000 characters)');
      } else {
        createToast('Snippet saved');
      }
    }
  }, 10);
}

function addSnippet(snippet) {
  state.items.push(snippet);
  updateUI();
  persistState();
}

function handleRemove(id) {
  state.items = state.items.filter(item => item.id !== id);
  updateUI();
  persistState();
  createToast('Snippet removed');
}

function handleClear() {
  if (state.items.length === 0) return;
  if (confirm(`Clear all ${state.items.length} snippet${state.items.length !== 1 ? 's' : ''}?`)) {
    state.items = [];
    updateUI();
    persistState();
    createToast('All snippets cleared');
  }
}

async function handleCopy() {
  if (state.items.length === 0) {
    createToast('No snippets to copy');
    return;
  }
  const markdown = state.items
    .map(snippet => `- ${snippet.text}`)
    .join('\n');
  try {
    await navigator.clipboard.writeText(markdown);
    createToast(`Copied ${state.items.length} snippet${state.items.length !== 1 ? 's' : ''} to clipboard`);
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
}

function handleClose() {
  state.panelOpen = false;
  if (panel) {
    panel.classList.remove('ce-panel-open');
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
