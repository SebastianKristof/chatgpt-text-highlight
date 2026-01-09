/**
 * Main content script entry point.
 * Orchestrates selection, state management, UI, and persistence.
 */

import { loadSnippets, saveSnippets } from './storage.js';
import { buildSnippetFromSelection } from './selection.js';
import { navigateToSource } from './navigation.js';
import { createContainer, createFAB, createPanel, createToast, updateFABCount, updatePanel } from './ui.js';

// State
let state = {
  items: [],
  panelOpen: false
};

// UI elements
let container = null;
let fab = null;
let panel = null;

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
    onSnippetClick: handleSnippetClick
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
    if (e.key === 'Escape' && state.panelOpen) {
      handleClose();
    }
  });
  
  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
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
