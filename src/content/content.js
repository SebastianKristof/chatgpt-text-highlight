/**
 * Main content script entry point.
 * Orchestrates selection, state management, UI, and persistence.
 */

import { loadStorage, saveStorage, upsertSnippet, removeSnippet, clearThread, clearAll } from './storage.js';
import { buildSnippetFromSelection, getConversationId } from './selection.js';
import { navigateToSource } from './navigation.js';
import { hashText } from '../shared/hash.js';
import { getProjectIdFromUrl } from '../shared/urlIds.js';
import { createContainer, createFAB, createPanel, createImportExportModal, createToast, updateFABCount, updatePanel } from './ui.js';

// State
let state = {
  storage: {
    snippetsById: {},
    index: {
      byThread: {},
      byTime: []
    },
    meta: {
      lastUpdatedAt: 0,
      totalCount: 0
    }
  },
  panelOpen: false,
  settings: {
    autoSave: true, // Default to auto-save enabled
    theme: 'auto' // Default to auto (follows system)
  },
  searchQuery: '',
  searchScope: 'thread', // 'thread', 'project', or 'all'
  sortOrder: 'desc',
  // Cache for performance optimization
  cache: {
    key: null,
    currentSnippets: [],
    totalSnippets: [],
    itemsVersion: 0
  },
  // Selection cache
  selectionCache: {
    visibleIds: new Set(),
    selectedVisibleCount: 0
  },
  selectedIds: new Set()
};

// Theme management
const DEFAULT_THEME = 'auto';

// Deduplication state
let lastSnippetHash = null;
let lastSnippetTime = 0;
const DEDUPE_WINDOW_MS = 1000; // 1 second

// UI elements
let container = null;
let fab = null;
let panel = null;
let importExportModal = null;
let modalOpen = false;

const SCHEMA_VERSION = 2;

/**
 * Debounce utility function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function generateSnippetId() {
  return `snippet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

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
    projectId: typeof raw.projectId === 'string' ? raw.projectId : null,
    sourceUrl: typeof raw.sourceUrl === 'string' ? raw.sourceUrl : null,
    anchor: raw.anchor && typeof raw.anchor === 'object' ? raw.anchor : null,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : (Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now()),
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
  return snippets.map((snippet) => `- ${snippet.text}`).join('\n');
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

/**
 * Gets a snippet by ID.
 * @param {string} id - Snippet ID
 * @returns {Object|null} Snippet object or null
 */
function getSnippetById(id) {
  return state.storage.snippetsById[id] || null;
}

/**
 * Gets the current project ID from the URL.
 * @returns {string|null} Project ID or null
 */
function getCurrentProjectId() {
  return getProjectIdFromUrl(window.location.href);
}

/**
 * Gets total count of snippets for a conversation.
 * @param {string|null} conversationId - Conversation ID or null for all
 * @returns {number} Count of snippets
 */
function getTotalCountForConversation(conversationId) {
  if (conversationId === null) {
    return state.storage.meta.totalCount || 0;
  }
  const threadIds = state.storage.index.byThread[conversationId] || [];
  return threadIds.length;
}

/**
 * Gets all snippets with optional filtering and sorting.
 * @param {string} searchQuery - Optional search query
 * @param {string} sortOrder - 'asc' or 'desc' (default: 'desc')
 * @returns {Array} Array of snippet objects
 */
function getAllSnippets(searchQuery = '', sortOrder = 'desc') {
  const { snippetsById, index } = state.storage;
  let snippets = [];
  
  // Get all snippets from byTime index (already sorted by createdAt desc)
  index.byTime.forEach(id => {
    const snippet = snippetsById[id];
    if (snippet) {
      snippets.push(snippet);
    }
  });
  
  // Apply search filter
  if (searchQuery && searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    snippets = snippets.filter(snippet => 
      snippet.text && snippet.text.toLowerCase().includes(query)
    );
  }
  
  // Apply sort order
  if (sortOrder === 'asc') {
    snippets.reverse();
  }
  
  return snippets;
}

/**
 * Gets snippets for a specific conversation with optional filtering and sorting.
 * @param {string|null} conversationId - Conversation ID or null for all
 * @param {string} searchQuery - Optional search query
 * @param {string} sortOrder - 'asc' or 'desc' (default: 'desc')
 * @returns {Array} Array of snippet objects
 */
function getSnippetsForConversation(conversationId, searchQuery = '', sortOrder = 'desc') {
  const { snippetsById, index } = state.storage;
  let snippets = [];
  
  if (conversationId === null) {
    // Get all snippets
    return getAllSnippets(searchQuery, sortOrder);
  }
  
  // Get snippets for this conversation from index
  const threadIds = index.byThread[conversationId] || [];
  threadIds.forEach(id => {
    const snippet = snippetsById[id];
    if (snippet) {
      snippets.push(snippet);
    }
  });
  
  // Sort by createdAt
  snippets.sort((a, b) => {
    const aTime = a.createdAt || 0;
    const bTime = b.createdAt || 0;
    return sortOrder === 'desc' ? bTime - aTime : aTime - bTime;
  });
  
  // Apply search filter
  if (searchQuery && searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    snippets = snippets.filter(snippet => 
      snippet.text && snippet.text.toLowerCase().includes(query)
    );
  }
  
  return snippets;
}

/**
 * Gets snippets filtered by scope with optional search and sorting.
 * @param {string} scope - Scope: 'thread', 'project', or 'all'
 * @param {string} searchQuery - Optional search query
 * @param {string} sortOrder - 'asc' or 'desc' (default: 'desc')
 * @returns {Array} Array of snippet objects
 */
function getSnippetsByScope(scope, searchQuery = '', sortOrder = 'desc') {
  const { snippetsById, index } = state.storage;
  let snippets = [];
  
  if (scope === 'thread') {
    // Current conversation
    const conversationId = getConversationId();
    if (conversationId === null) {
      return [];
    }
    const threadIds = index.byThread[conversationId] || [];
    threadIds.forEach(id => {
      const snippet = snippetsById[id];
      if (snippet) {
        snippets.push(snippet);
      }
    });
    
    // Sort by createdAt
    snippets.sort((a, b) => {
      const aTime = a.createdAt || 0;
      const bTime = b.createdAt || 0;
      return sortOrder === 'desc' ? bTime - aTime : aTime - bTime;
    });
  } else if (scope === 'project') {
    // All snippets in current project
    const currentProjectId = getCurrentProjectId();
    if (currentProjectId === null) {
      // Fallback to thread if no projectId
      return getSnippetsByScope('thread', searchQuery, sortOrder);
    }
    
    const projectIds = index.byProject[currentProjectId] || [];
    projectIds.forEach(id => {
      const snippet = snippetsById[id];
      if (snippet) {
        snippets.push(snippet);
      }
    });
    
    // Sort by createdAt
    snippets.sort((a, b) => {
      const aTime = a.createdAt || 0;
      const bTime = b.createdAt || 0;
      return sortOrder === 'desc' ? bTime - aTime : aTime - bTime;
    });
  } else {
    // All snippets
    return getAllSnippets(searchQuery, sortOrder);
  }
  
  // Apply search filter
  if (searchQuery && searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    snippets = snippets.filter(snippet => 
      snippet.text && snippet.text.toLowerCase().includes(query)
    );
  }
  
  return snippets;
}

/**
 * Initializes the extension.
 */
async function init() {
  // Create container
  container = createContainer();
  
  // Load snippets from storage
  await loadState();
  
  // Apply theme
  applyTheme(state.settings.theme || DEFAULT_THEME);
  
  // Listen to system theme changes for auto mode
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (state.settings.theme === 'auto') {
        applyTheme('auto');
      }
    });
  }
  
  // Create UI
  renderUI();
  
  // Set up event listeners
  setupEventListeners();
  
  // Show toast if snippets were loaded
  const totalCount = state.storage.meta.totalCount || 0;
  if (totalCount > 0) {
    createToast(`Loaded ${totalCount} snippet${totalCount !== 1 ? 's' : ''}`);
  }
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
}

/**
 * Gets current theme setting.
 * @returns {string} Current theme
 */
function getCurrentTheme() {
  return state.settings.theme || DEFAULT_THEME;
}

/**
 * Loads state from storage.
 */
async function loadState() {
  try {
    const storage = await loadStorage();
    state.storage = storage;
    
    // Reset cache
    state.cache.key = null;
    state.cache.itemsVersion = 0;
    state.selectionCache.visibleIds = new Set();
    state.selectionCache.selectedVisibleCount = 0;
    state.selectedIds = new Set();
    
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

/**
 * Saves state to storage.
 */
async function persistState() {
  try {
    await saveStorage(state.storage);
    // Increment itemsVersion for cache invalidation
    state.cache.itemsVersion += 1;
    // Save settings separately
    await chrome.storage.local.set({ settings: state.settings });
  } catch (error) {
    console.error('Failed to save state:', error);
    // Show user-friendly error message
    const message = error.message && error.message.includes('quota') 
      ? 'Storage full. Please clear some snippets or export your data.'
      : 'Failed to save snippets';
    createToast(message);
  }
}

/**
 * Gets current conversation snippets with caching.
 * Uses scope filtering when search is active.
 * @returns {Array} Array of snippet objects for current conversation
 */
function getCurrentConversationSnippets() {
  const conversationId = getConversationId();
  const url = window.location.href;
  const isMainPage = !url.includes('/c/') && !url.includes('conversationId=');
  const hasSearchQuery = state.searchQuery && state.searchQuery.trim();
  
  // Build cache key
  const cacheKey = JSON.stringify({
    conversationId,
    isMainPage,
    searchQuery: state.searchQuery || '',
    searchScope: state.searchScope || 'thread',
    sortOrder: state.sortOrder || 'desc',
    itemsVersion: state.cache.itemsVersion
  });
  
  // Check cache
  if (state.cache.key === cacheKey && state.cache.currentSnippets.length >= 0) {
    return state.cache.currentSnippets;
  }
  
  // Recompute
  let snippets = [];
  
  // If search is active, use scope filtering
  if (hasSearchQuery) {
    // Check if scope is 'project' but no projectId - fallback to 'thread'
    let scope = state.searchScope || 'thread';
    if (scope === 'project' && getCurrentProjectId() === null) {
      scope = 'thread';
      state.searchScope = 'thread'; // Update state to reflect fallback
    }
    snippets = getSnippetsByScope(scope, state.searchQuery || '', state.sortOrder || 'desc');
  } else {
    // No search: default to current thread behavior
    if (isMainPage) {
      snippets = getAllSnippets('', state.sortOrder || 'desc');
    } else if (conversationId) {
      snippets = getSnippetsForConversation(conversationId, '', state.sortOrder || 'desc');
    }
  }
  
  // Update cache
  state.cache.key = cacheKey;
  state.cache.currentSnippets = snippets;
  
  // Update selection cache
  state.selectionCache.visibleIds = new Set(snippets.map(s => s.id));
  state.selectionCache.selectedVisibleCount = snippets.filter(s => state.selectedIds.has(s.id)).length;
  
  return snippets;
}

/**
 * Renders the UI.
 */
function renderUI() {
  // Get snippets for current conversation
  const currentSnippets = getCurrentConversationSnippets();
  const conversationId = getConversationId();
  const url = window.location.href;
  const isMainPage = !url.includes('/c/') && !url.includes('conversationId=');
  
  // Get total count for current conversation
  let totalCount = 0;
  if (isMainPage) {
    totalCount = state.storage.meta.totalCount || 0;
  } else if (conversationId) {
    totalCount = getTotalCountForConversation(conversationId);
  }
  
  // Create FAB
  if (fab && fab.parentNode) {
    fab.parentNode.removeChild(fab);
  }
  fab = createFAB(totalCount, togglePanel);
  container.appendChild(fab);
  
  // Create panel (initially hidden)
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
    onManage: handleOpenImportExport,
    onToggleAutoSave: handleToggleAutoSave,
    autoSaveEnabled: state.settings.autoSave,
    onToggleTheme: handleToggleTheme,
    currentTheme: getCurrentTheme(),
    totalCount: totalCount,
    searchQuery: state.searchQuery || '',
    onSearch: handleSearch,
    onScopeChange: handleScopeChange,
    currentScope: state.searchScope || 'thread',
    currentProjectId: getCurrentProjectId()
  });
  panel.classList.toggle('ce-panel-open', state.panelOpen);
  container.appendChild(panel);
}

/**
 * Updates the UI after state changes.
 */
function updateUI() {
  // Invalidate cache to force recompute
  state.cache.key = null;
  
  // Get current snippets
  const currentSnippets = getCurrentConversationSnippets();
  const conversationId = getConversationId();
  const url = window.location.href;
  const isMainPage = !url.includes('/c/') && !url.includes('conversationId=');
  
  // Get total count for current conversation
  let totalCount = 0;
  if (isMainPage) {
    totalCount = state.storage.meta.totalCount || 0;
  } else if (conversationId) {
    totalCount = getTotalCountForConversation(conversationId);
  }
  
  if (fab) {
    updateFABCount(fab, totalCount);
  }
  
  if (panel) {
    console.log('[updateUI] Calling updatePanel with:', {
      searchQuery: state.searchQuery || '',
      searchScope: state.searchScope || 'thread',
      currentProjectId: getCurrentProjectId(),
      snippetsCount: currentSnippets.length
    });
    updatePanel(
      panel, 
      currentSnippets, 
      handleRemove, 
      handleSnippetClick, 
      totalCount, 
      state.searchQuery || '',
      handleSearch,
      handleScopeChange,
      state.searchScope || 'thread',
      getCurrentProjectId()
    );
  } else {
    console.warn('[updateUI] Panel not found, calling renderUI instead');
    renderUI();
  }
}

/**
 * Sets up event listeners.
 */
function setupEventListeners() {
  // Listen for text selection with debounce
  const debouncedHandleSelection = debounce(handleSelection, 100);
  document.addEventListener('mouseup', debouncedHandleSelection);
  
  // Close panel on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOpen) {
      handleCloseImportExport();
      return;
    }
    if (e.key === 'Escape' && state.panelOpen) {
      handleClose();
    }
  });
  
  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
    if (modalOpen) return;
    if (state.panelOpen && panel && !panel.contains(e.target) && !fab.contains(e.target)) {
      handleClose();
    }
  });
}

/**
 * Handles text selection events.
 */
function handleSelection(e) {
  // Small delay to ensure selection is complete
  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }
    
    // Don't create snippet if clicking in UI
    if (container && container.contains(e.target)) {
      return;
    }
    
    // Check if auto-save is enabled
    if (!state.settings.autoSave) {
      return;
    }
    
    const snippet = buildSnippetFromSelection();
    if (snippet && snippet.text && snippet.text.length >= 3) {
      // Deduplication check
      const hash = hashText(snippet.text);
      const now = Date.now();
      if (hash === lastSnippetHash && now - lastSnippetTime < DEDUPE_WINDOW_MS) {
        return; // Skip duplicate
      }
      lastSnippetHash = hash;
      lastSnippetTime = now;
      
      addSnippet(snippet);
      
      // Show toast if truncated
      if (snippet.truncated) {
        createToast('Snippet truncated (max 10,000 characters)');
      } else {
        createToast('Snippet saved');
      }
    }
  }, 10);
}

/**
 * Adds a snippet to state.
 */
function addSnippet(snippet) {
  // Ensure snippet has required fields
  if (!snippet.id) {
    snippet.id = generateSnippetId();
  }
  if (!snippet.createdAt) {
    snippet.createdAt = Date.now();
  }
  
  // Use upsertSnippet to add/update
  state.storage = upsertSnippet(state.storage, snippet);
  
  // Invalidate cache
  state.cache.key = null;
  state.cache.itemsVersion += 1;
  
  updateUI();
  persistState();
}

/**
 * Removes a snippet by ID.
 */
function handleRemove(id) {
  state.storage = removeSnippet(state.storage, id);
  
  // Remove from selection if selected
  state.selectedIds.delete(id);
  
  // Invalidate cache
  state.cache.key = null;
  state.cache.itemsVersion += 1;
  
  updateUI();
  persistState();
  createToast('Snippet removed');
}

/**
 * Clears all snippets.
 */
function handleClear() {
  const totalCount = state.storage.meta.totalCount || 0;
  if (totalCount === 0) return;
  
  if (confirm(`Clear all ${totalCount} snippet${totalCount !== 1 ? 's' : ''}?`)) {
    state.storage = clearAll(state.storage);
    
    // Clear selection
    state.selectedIds.clear();
    state.selectionCache.selectedVisibleCount = 0;
    
    // Invalidate cache
    state.cache.key = null;
    state.cache.itemsVersion += 1;
    
    updateUI();
    persistState();
    createToast('All snippets cleared');
  }
}

/**
 * Copies all snippets to clipboard.
 */
async function handleCopy() {
  const allSnippets = getAllSnippets();
  if (allSnippets.length === 0) {
    createToast('No snippets to copy');
    return;
  }
  
  const markdown = buildMarkdownFromSnippets(allSnippets);
  
  try {
    await navigator.clipboard.writeText(markdown);
    createToast(`Copied ${allSnippets.length} snippet${allSnippets.length !== 1 ? 's' : ''} to clipboard`);
  } catch (error) {
    console.error('Failed to copy:', error);
    createToast('Failed to copy to clipboard');
  }
}

function handleOpenImportExport() {
  if (modalOpen) return;
  const totalCount = state.storage.meta.totalCount || 0;
  importExportModal = createImportExportModal({
    snippetCount: totalCount,
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
  const allSnippets = getAllSnippets();
  if (allSnippets.length === 0) {
    createToast('No snippets to export');
    return;
  }
  
  // Convert v2 to v1 format for backward compatibility
  const items = allSnippets.map(snippet => {
    const exported = { ...snippet };
    // Convert createdAt back to timestamp for v1 compatibility
    if (exported.createdAt && !exported.timestamp) {
      exported.timestamp = exported.createdAt;
    }
    return exported;
  });
  
  const payload = {
    schemaVersion: 1, // Export as v1 for compatibility
    exportedAt: new Date().toISOString(),
    items
  };
  downloadTextFile(exportFilename('json'), JSON.stringify(payload, null, 2), 'application/json');
  createToast(`Exported ${allSnippets.length} snippet${allSnippets.length !== 1 ? 's' : ''}`);
}

function handleExportMarkdown() {
  const allSnippets = getAllSnippets();
  if (allSnippets.length === 0) {
    createToast('No snippets to export');
    return;
  }
  const markdown = buildMarkdownFromSnippets(allSnippets);
  downloadTextFile(exportFilename('md'), markdown, 'text/markdown');
  createToast(`Exported ${allSnippets.length} snippet${allSnippets.length !== 1 ? 's' : ''}`);
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
    const currentCount = state.storage.meta.totalCount || 0;
    if (mode === 'replace') {
      const preview = `Preview: ${expanded.length} snippet${expanded.length !== 1 ? 's' : ''} will replace ${currentCount}.` +
        (duplicates ? ` ${duplicates} duplicate${duplicates !== 1 ? 's' : ''} in file will be labeled.` : '');
      setStatus('Preview ready.', 'success');
      setPreview(preview, 'success');
      setPending({ items: expanded });
      return;
    }
    // For merge mode, we need to check against existing snippets
    const existingSnippets = getAllSnippets();
    const { items: merged, added, skipped } = mergeSnippets(existingSnippets, expanded);
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
      // Clear all and add new snippets
      state.storage = clearAll(state.storage);
      state.selectedIds.clear();
      state.selectionCache.selectedVisibleCount = 0;
      
      // Add all imported snippets
      for (const snippet of pending.items) {
        if (!snippet.createdAt) {
          snippet.createdAt = snippet.timestamp || Date.now();
        }
        state.storage = upsertSnippet(state.storage, snippet);
      }
      
      // Invalidate cache
      state.cache.key = null;
      state.cache.itemsVersion += 1;
      
      updateUI();
      await persistState();
      setStatus(`Imported ${pending.items.length} snippet${pending.items.length !== 1 ? 's' : ''}.`, 'success');
      setPreview('Import complete. You can select another file to import.', 'success');
      setPending(null);
      return;
    }
    
    // Merge mode: add new snippets, skip duplicates
    const existingSnippets = getAllSnippets();
    const { items: merged, added, skipped } = mergeSnippets(existingSnippets, pending.items);
    
    // Clear and rebuild storage with merged snippets
    state.storage = clearAll(state.storage);
    for (const snippet of merged) {
      if (!snippet.createdAt) {
        snippet.createdAt = snippet.timestamp || Date.now();
      }
      state.storage = upsertSnippet(state.storage, snippet);
    }
    
    // Invalidate cache
    state.cache.key = null;
    state.cache.itemsVersion += 1;
    
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

/**
 * Handles snippet click for source navigation.
 */
function handleSnippetClick(snippet) {
  const result = navigateToSource(snippet);
  if (!result.success) {
    createToast(result.reason || 'Source not found');
  }
}

/**
 * Toggles the panel visibility.
 */
function togglePanel() {
  state.panelOpen = !state.panelOpen;
  if (panel) {
    panel.classList.toggle('ce-panel-open', state.panelOpen);
  }
}

/**
 * Closes the panel.
 */
function handleClose() {
  state.panelOpen = false;
  if (panel) {
    panel.classList.remove('ce-panel-open');
  }
}

/**
 * Toggles auto-save setting.
 */
async function handleToggleAutoSave() {
  state.settings.autoSave = !state.settings.autoSave;
  await persistState();
  updateUI();
  createToast(`Auto-save ${state.settings.autoSave ? 'enabled' : 'disabled'}`);
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

/**
 * Handles search query changes.
 * @param {string} query - Search query
 */
function handleSearch(query) {
  console.log('[handleSearch] Called with query:', query);
  state.searchQuery = query || '';
  
  // Reset scope to thread when search is cleared
  if (!state.searchQuery || !state.searchQuery.trim()) {
    state.searchScope = 'thread';
  }
  
  // Invalidate cache to force recompute
  state.cache.key = null;
  
  console.log('[handleSearch] State updated:', {
    searchQuery: state.searchQuery,
    searchScope: state.searchScope,
    hasPanel: !!panel
  });
  
  updateUI();
}

/**
 * Handles scope change for search filtering.
 * @param {string} scope - New scope: 'thread', 'project', or 'all'
 */
function handleScopeChange(scope) {
  // Validate scope
  if (!['thread', 'project', 'all'].includes(scope)) {
    return;
  }
  
  // If switching to project but no projectId, fallback to thread
  if (scope === 'project' && getCurrentProjectId() === null) {
    scope = 'thread';
  }
  
  state.searchScope = scope;
  
  // Invalidate cache to force recompute
  state.cache.key = null;
  
  updateUI();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
