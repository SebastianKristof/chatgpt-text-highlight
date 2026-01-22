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
 * @param {Function} config.onToggleAutoSave - Toggle auto-save handler (optional)
 * @param {boolean} config.autoSaveEnabled - Whether auto-save is enabled (optional)
 * @param {Function} config.onToggleTheme - Toggle theme handler (optional)
 * @param {string} config.currentTheme - Current theme: 'light', 'dark', or 'auto' (optional)
 * @param {number} config.totalCount - Total count for search counter (optional)
 * @param {string} config.searchQuery - Current search query (optional)
 * @returns {HTMLElement} Panel element
 */
export function createPanel({ snippets, onCopy, onClear, onClose, onRemove, onSnippetClick, onManage, onToggleAutoSave, autoSaveEnabled, onToggleTheme, currentTheme, totalCount, searchQuery }) {
  const panel = document.createElement('div');
  panel.className = 'ce-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Collected snippets');
  
  const header = createPanelHeader({ 
    onCopy, 
    onClear, 
    onClose, 
    onManage, 
    onToggleAutoSave,
    autoSaveEnabled,
    onToggleTheme,
    currentTheme,
    snippetCount: snippets.length,
    totalCount: totalCount !== undefined ? totalCount : snippets.length,
    searchQuery: searchQuery || ''
  });
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
function createPanelHeader({ onCopy, onClear, onClose, onManage, onToggleAutoSave, autoSaveEnabled, onToggleTheme, currentTheme, snippetCount, totalCount, searchQuery }) {
  const header = document.createElement('div');
  header.className = 'ce-panel-header';
  
  // Title row with close icon
  const titleRow = document.createElement('div');
  titleRow.className = 'ce-panel-title-row';
  
  const title = document.createElement('h2');
  title.className = 'ce-panel-title';
  
  // Show search counter if search is active
  if (searchQuery && searchQuery.trim() && totalCount !== undefined && totalCount !== snippetCount) {
    title.textContent = `Collected Snippets (${snippetCount} of ${totalCount})`;
  } else {
    title.textContent = 'Collected Snippets';
  }
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ce-btn ce-btn-icon';
  closeBtn.setAttribute('aria-label', 'Close panel');
  closeBtn.innerHTML = '×';
  closeBtn.addEventListener('click', onClose);
  
  titleRow.appendChild(title);
  titleRow.appendChild(closeBtn);
  
  // Actions row (without close button)
  const actions = document.createElement('div');
  actions.className = 'ce-panel-actions';
  
  // Theme toggle button
  if (onToggleTheme) {
    const themeIcons = { auto: '⚙', light: '☀', dark: '🌙' };
    const themeLabels = { auto: 'Auto', light: 'Light', dark: 'Dark' };
    const themeBtn = document.createElement('button');
    themeBtn.className = 'ce-btn ce-btn-icon ce-btn-theme';
    themeBtn.innerHTML = themeIcons[currentTheme] || '⚙';
    themeBtn.setAttribute('aria-label', `Theme: ${themeLabels[currentTheme] || 'Auto'}`);
    themeBtn.title = `Theme: ${themeLabels[currentTheme] || 'Auto'} (click to change)`;
    themeBtn.addEventListener('click', onToggleTheme);
    actions.appendChild(themeBtn);
  }
  
  // Auto-save toggle button
  if (onToggleAutoSave) {
    const autoSaveBtn = document.createElement('button');
    autoSaveBtn.className = 'ce-btn ce-btn-secondary ce-btn-auto-save';
    autoSaveBtn.textContent = autoSaveEnabled ? 'Auto-save: ON' : 'Auto-save: OFF';
    autoSaveBtn.setAttribute('aria-label', `Auto-save is ${autoSaveEnabled ? 'enabled' : 'disabled'}`);
    autoSaveBtn.title = autoSaveEnabled ? 'Click to disable auto-save' : 'Click to enable auto-save';
    autoSaveBtn.addEventListener('click', onToggleAutoSave);
    actions.appendChild(autoSaveBtn);
  }
  
  const copyBtn = document.createElement('button');
  copyBtn.className = 'ce-btn ce-btn-secondary ce-btn-copy';
  copyBtn.textContent = 'Copy';
  copyBtn.setAttribute('aria-label', 'Copy all snippets');
  copyBtn.addEventListener('click', onCopy);
  copyBtn.disabled = snippetCount === 0;
  
  const clearBtn = document.createElement('button');
  clearBtn.className = 'ce-btn ce-btn-secondary ce-btn-clear';
  clearBtn.textContent = 'Clear';
  clearBtn.setAttribute('aria-label', 'Clear all snippets');
  clearBtn.addEventListener('click', onClear);
  clearBtn.disabled = snippetCount === 0;
  
  const manageBtn = document.createElement('button');
  manageBtn.className = 'ce-btn ce-btn-secondary ce-btn-manage';
  manageBtn.textContent = 'Import/Export';
  manageBtn.setAttribute('aria-label', 'Import or export snippets');
  manageBtn.addEventListener('click', onManage);
  
  actions.appendChild(copyBtn);
  actions.appendChild(clearBtn);
  actions.appendChild(manageBtn);
  
  header.appendChild(titleRow);
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
  const timeEl = document.createElement('span');
  timeEl.textContent = timeStr;
  meta.appendChild(timeEl);
  
  if (snippet.duplicateIndex && snippet.duplicateIndex > 1) {
    const dup = document.createElement('span');
    dup.className = 'ce-duplicate-badge';
    dup.textContent = `Duplicate #${snippet.duplicateIndex}`;
    meta.appendChild(dup);
  }
  
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
 * Creates the import/export modal.
 * @param {Object} config - Modal configuration
 * @returns {HTMLElement} Modal overlay
 */
export function createImportExportModal({ snippetCount, onClose, onExportJson, onExportMarkdown, onPreview, onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'ce-modal-overlay ce-extension';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      onClose();
    }
  });

  const modal = document.createElement('div');
  modal.className = 'ce-modal ce-modal-show';

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

  const importRow = document.createElement('div');
  importRow.className = 'ce-modal-row';

  const radioGroup = document.createElement('div');
  radioGroup.className = 'ce-radio-group';

  const mergeId = `ce-import-merge-${Date.now()}`;
  const replaceId = `ce-import-replace-${Date.now()}`;

  const mergeLabel = document.createElement('label');
  mergeLabel.className = 'ce-radio';
  const mergeInput = document.createElement('input');
  mergeInput.type = 'radio';
  mergeInput.name = 'ce-import-mode';
  mergeInput.id = mergeId;
  mergeInput.checked = true;
  mergeLabel.appendChild(mergeInput);
  mergeLabel.append('Merge (skip duplicates)');

  const replaceLabel = document.createElement('label');
  replaceLabel.className = 'ce-radio';
  const replaceInput = document.createElement('input');
  replaceInput.type = 'radio';
  replaceInput.name = 'ce-import-mode';
  replaceInput.id = replaceId;
  replaceLabel.appendChild(replaceInput);
  replaceLabel.append('Replace existing');

  radioGroup.appendChild(mergeLabel);
  radioGroup.appendChild(replaceLabel);

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
 * @param {number} totalCount - Total count for search counter (optional)
 * @param {string} searchQuery - Current search query (optional)
 */
export function updatePanel(panel, snippets, onRemove, onSnippetClick, totalCount, searchQuery) {
  const list = panel.querySelector('.ce-snippet-list');
  if (!list) return;
  
  // Clear existing items
  list.innerHTML = '';
  
  if (snippets.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'ce-empty-state';
    emptyState.textContent = searchQuery && searchQuery.trim() 
      ? 'No snippets match your search' 
      : 'Select text to save a snippet';
    list.appendChild(emptyState);
  } else {
    snippets.forEach((snippet, index) => {
      const item = createSnippetItem(snippet, index, onRemove, onSnippetClick);
      list.appendChild(item);
    });
  }
  
  // Update title with search counter if search is active
  const title = panel.querySelector('.ce-panel-title');
  if (title && searchQuery && searchQuery.trim() && totalCount !== undefined && totalCount !== snippets.length) {
    title.textContent = `Collected Snippets (${snippets.length} of ${totalCount})`;
  } else if (title) {
    title.textContent = 'Collected Snippets';
  }
  
  // Update button states
  const copyBtn = panel.querySelector('.ce-btn-copy');
  const clearBtn = panel.querySelector('.ce-btn-clear');
  if (copyBtn) copyBtn.disabled = snippets.length === 0;
  if (clearBtn) clearBtn.disabled = snippets.length === 0;
}
