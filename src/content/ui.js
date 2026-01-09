/**
 * UI components: FAB, panel, and toast notifications.
 */

const CONTAINER_ID = 'ce-root';

/**
 * Creates the extension UI container.
 * @returns {HTMLElement} Container element
 */
export function createContainer() {
  let container = document.getElementById(CONTAINER_ID);
  if (container) return container;
  
  container = document.createElement('div');
  container.id = CONTAINER_ID;
  container.className = 'ce-extension';
  document.body.appendChild(container);
  return container;
}

/**
 * Creates the Floating Action Button (FAB).
 * @param {number} count - Number of snippets
 * @param {Function} onClick - Click handler
 * @returns {HTMLElement} FAB element
 */
export function createFAB(count, onClick) {
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

/**
 * Creates the panel overlay.
 * @param {Object} config - Panel configuration
 * @param {Array} config.snippets - Array of snippets
 * @param {Function} config.onCopy - Copy handler
 * @param {Function} config.onClear - Clear handler
 * @param {Function} config.onClose - Close handler
 * @param {Function} config.onRemove - Remove handler (id) => void
 * @param {Function} config.onSnippetClick - Snippet click handler (snippet) => void
 * @returns {HTMLElement} Panel element
 */
export function createPanel({ snippets, onCopy, onClear, onClose, onRemove, onSnippetClick }) {
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

/**
 * Creates the panel header.
 */
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

/**
 * Creates the snippet list.
 */
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

/**
 * Creates a single snippet item.
 */
function createSnippetItem(snippet, index, onRemove, onSnippetClick) {
  const item = document.createElement('div');
  item.className = 'ce-snippet-item';
  item.setAttribute('data-snippet-id', snippet.id);
  
  const text = document.createElement('div');
  text.className = 'ce-snippet-text';
  text.textContent = snippet.text;
  text.setAttribute('title', snippet.text);
  
  // Make text clickable for navigation
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

/**
 * Creates the panel footer.
 */
function createPanelFooter() {
  const footer = document.createElement('div');
  footer.className = 'ce-panel-footer';
  footer.textContent = 'Click a snippet to navigate to its source';
  return footer;
}

/**
 * Creates a toast notification.
 * @param {string} message - Toast message
 * @param {number} duration - Duration in milliseconds
 * @returns {HTMLElement} Toast element
 */
export function createToast(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'ce-toast';
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  
  const container = document.getElementById(CONTAINER_ID) || createContainer();
  container.appendChild(toast);
  
  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('ce-toast-show');
  });
  
  // Remove after duration
  setTimeout(() => {
    toast.classList.remove('ce-toast-show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300); // Wait for fade-out animation
  }, duration);
  
  return toast;
}

/**
 * Updates the FAB count.
 * @param {HTMLElement} fab - FAB element
 * @param {number} count - New count
 */
export function updateFABCount(fab, count) {
  const countEl = fab.querySelector('.ce-fab-count');
  if (countEl) {
    countEl.textContent = count;
  }
  fab.setAttribute('aria-label', `Collected snippets: ${count}`);
}

/**
 * Updates the panel with new snippets.
 * @param {HTMLElement} panel - Panel element
 * @param {Array} snippets - New snippets array
 * @param {Function} onRemove - Remove handler
 * @param {Function} onSnippetClick - Snippet click handler
 */
export function updatePanel(panel, snippets, onRemove, onSnippetClick) {
  const list = panel.querySelector('.ce-snippet-list');
  if (!list) return;
  
  // Clear existing items
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
  
  // Update button states
  const copyBtn = panel.querySelector('.ce-btn[aria-label="Copy all snippets"]');
  const clearBtn = panel.querySelector('.ce-btn[aria-label="Clear all snippets"]');
  if (copyBtn) copyBtn.disabled = snippets.length === 0;
  if (clearBtn) clearBtn.disabled = snippets.length === 0;
}
