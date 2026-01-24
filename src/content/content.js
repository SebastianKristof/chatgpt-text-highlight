/**
 * Main content script entry point.
 * Orchestrates selection, state management, UI, and persistence.
 */

import { loadSnippets, saveSnippets } from './storage.js';
import { buildSnippetFromSelection } from './selection.js';
import { navigateToSource } from './navigation.js';
import { hashText } from '../shared/hash.js';
import { createContainer, createFAB, createPanel, createImportExportModal, createToast, updateFABCount, updatePanel } from './ui.js';

// State
let state = {
  items: [],
  panelOpen: false,
  settings: {
    autoSave: true, // Default to auto-save enabled
    theme: 'auto' // Default to auto (follows system)
  }
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

const SCHEMA_VERSION = 1;

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
  if (state.items.length > 0) {
    createToast(`Loaded ${state.items.length} snippet${state.items.length !== 1 ? 's' : ''}`);
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

/**
 * Saves state to storage.
 */
async function persistState() {
  try {
    await saveSnippets(state.items);
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
 * Renders the UI.
 */
function renderUI() {
  // Create FAB
  if (fab && fab.parentNode) {
    fab.parentNode.removeChild(fab);
  }
  fab = createFAB(state.items.length, togglePanel);
  container.appendChild(fab);
  
  // Create panel (initially hidden)
  if (panel && panel.parentNode) {
    panel.parentNode.removeChild(panel);
  }
  panel = createPanel({
    snippets: state.items,
    onCopy: handleCopy,
    onClear: handleClear,
    onClose: handleClose,
    onRemove: handleRemove,
    onSnippetClick: handleSnippetClick,
    onManage: handleOpenImportExport,
    onToggleAutoSave: handleToggleAutoSave,
    autoSaveEnabled: state.settings.autoSave,
    onToggleTheme: handleToggleTheme,
    currentTheme: getCurrentTheme()
  });
  panel.classList.toggle('ce-panel-open', state.panelOpen);
  container.appendChild(panel);
}

/**
 * Updates the UI after state changes.
 */
function updateUI() {
  if (fab) {
    updateFABCount(fab, state.items.length);
  }
  
  if (panel) {
    updatePanel(panel, state.items, handleRemove, handleSnippetClick);
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
  state.items.push(snippet);
  updateUI();
  persistState();
}

/**
 * Removes a snippet by ID.
 */
function handleRemove(id) {
  state.items = state.items.filter(item => item.id !== id);
  updateUI();
  persistState();
  createToast('Snippet removed');
}

/**
 * Clears all snippets.
 */
function handleClear() {
  if (state.items.length === 0) return;
  
  if (confirm(`Clear all ${state.items.length} snippet${state.items.length !== 1 ? 's' : ''}?`)) {
    state.items = [];
    updateUI();
    persistState();
    createToast('All snippets cleared');
  }
}

/**
 * Copies all snippets to clipboard.
 */
async function handleCopy() {
  if (state.items.length === 0) {
    createToast('No snippets to copy');
    return;
  }
  
  const markdown = buildMarkdownFromSnippets(state.items);
  
  try {
    await navigator.clipboard.writeText(markdown);
    createToast(`Copied ${state.items.length} snippet${state.items.length !== 1 ? 's' : ''} to clipboard`);
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

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
