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
  panelOpen: false
};

// UI elements
let container = null;
let fab = null;
let panel = null;
let importExportModal = null;
let modalOpen = false;

const SCHEMA_VERSION = 1;

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
  const seen = new Set(existing.map(snippetKey));
  const merged = [...existing];
  let added = 0;
  let skipped = 0;
  incoming.forEach((snippet) => {
    const key = snippetKey(snippet);
    if (seen.has(key)) {
      skipped += 1;
      return;
    }
    seen.add(key);
    merged.push(snippet);
    added += 1;
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
 * Loads state from storage.
 */
async function loadState() {
  try {
    const items = await loadSnippets();
    state.items = items;
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
  } catch (error) {
    console.error('Failed to save state:', error);
    createToast('Failed to save snippets');
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
    onManage: handleOpenImportExport
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
  // Listen for text selection
  document.addEventListener('mouseup', handleSelection);
  
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
    
    const snippet = buildSnippetFromSelection();
    if (snippet) {
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
    onImport: handleImport
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

async function handleImport(file, mode) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(items)) {
      createToast('Invalid JSON format');
      return;
    }
    const normalized = normalizeImportedSnippets(items);
    if (normalized.length === 0) {
      createToast('No valid snippets found');
      return;
    }
    if (mode === 'replace') {
      const { items: deduped, skipped } = dedupeSnippets(normalized);
      state.items = deduped;
      updateUI();
      await persistState();
      handleCloseImportExport();
      createToast(`Imported ${deduped.length} snippet${deduped.length !== 1 ? 's' : ''}${skipped ? ` (${skipped} duplicates skipped)` : ''}`);
      return;
    }
    const { items: merged, added, skipped } = mergeSnippets(state.items, normalized);
    state.items = merged;
    updateUI();
    await persistState();
    handleCloseImportExport();
    const suffix = skipped ? ` (${skipped} duplicates skipped)` : '';
    createToast(`Imported ${added} new snippet${added !== 1 ? 's' : ''}${suffix}`);
  } catch (error) {
    console.error('Failed to import snippets:', error);
    createToast('Failed to import snippets');
  }
}

/**
 * Handles snippet click for source navigation.
 */
function handleSnippetClick(snippet) {
  const success = navigateToSource(snippet);
  if (!success) {
    createToast('Source not found');
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

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
