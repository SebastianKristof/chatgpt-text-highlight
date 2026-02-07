/**
 * Selection extraction and snippet creation logic.
 */

import { buildAnchor, findSelectionOffsets } from '../shared/anchor.js';
import { getProjectIdFromUrl, getConversationIdFromUrl } from '../shared/urlIds.js';

const MAX_SELECTION_SIZE = 10000; // 10k chars limit
const MIN_SELECTION_LENGTH = 3; // Minimum characters to save a snippet

/**
 * Gets the conversation ID from the current URL.
 * @returns {string|null} Conversation ID or null
 */
export function getConversationId() {
  return getConversationIdFromUrl(window.location.href);
}

/**
 * Finds the message block containing the given node.
 * @param {Node} node - DOM node
 * @returns {HTMLElement|null} Message container element or null
 */
export function findMessageBlock(node) {
  if (!node) return null;
  
  let current = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  
  while (current) {
    // Check for data-message-id attribute (most reliable)
    if (current.hasAttribute && current.hasAttribute('data-message-id')) {
      return current;
    }
    
    // Check for role attribute
    if (current.getAttribute && current.getAttribute('data-message-author-role')) {
      return current;
    }
    
    // Check class names (fallback)
    if (current.className && typeof current.className === 'string') {
      const className = current.className.toLowerCase();
      if (className.includes('message') || className.includes('group')) {
        // Look for a parent that might be the actual message container
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

/**
 * Gets the message ID from a message block element.
 * @param {HTMLElement} messageBlock - Message container element
 * @returns {string|null} Message ID or null
 */
export function getMessageId(messageBlock) {
  if (!messageBlock) return null;
  
  const messageId = messageBlock.getAttribute?.('data-message-id');
  return messageId || null;
}

/**
 * Extracts the full text content from a message block.
 * @param {HTMLElement} messageBlock - Message container element
 * @returns {string} Normalized message text
 */
export function getMessageText(messageBlock) {
  if (!messageBlock) return '';
  
  // Get innerText which excludes script/style tags and normalizes whitespace
  const text = messageBlock.innerText || messageBlock.textContent || '';
  return text.trim();
}

/**
 * Checks if a selection is inside the extension UI.
 * @param {Selection} selection - DOM Selection object
 * @returns {boolean} True if selection is in extension UI
 */
export function isSelectionInExtensionUI(selection) {
  if (!selection || selection.rangeCount === 0) return false;
  
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const element = container.nodeType === Node.ELEMENT_NODE 
    ? container 
    : container.parentElement;
  
  if (!element) return false;
  
  // Check if element or any parent has the extension container ID
  let current = element;
  while (current && current !== document.body) {
    if (current.id === 'ce-root' || current.classList?.contains('ce-extension')) {
      return true;
    }
    current = current.parentElement;
  }
  
  return false;
}

/**
 * Gets the selected text from the current selection.
 * @returns {string} Selected text or empty string
 */
export function getSelectionText() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return '';
  
  return selection.toString().trim();
}

/**
 * Builds a snippet object from the current selection.
 * @returns {Object|null} Snippet object or null if creation fails
 */
export function buildSnippetFromSelection() {
  const selection = window.getSelection();
  
  // Check for collapsed or empty selection
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  
  // Check if selection is in extension UI
  if (isSelectionInExtensionUI(selection)) {
    return null;
  }
  
  const selectionText = getSelectionText();
  if (!selectionText || selectionText.length < MIN_SELECTION_LENGTH) return null;
  
  // Truncate if too large
  let finalText = selectionText;
  let truncated = false;
  if (finalText.length > MAX_SELECTION_SIZE) {
    finalText = finalText.substring(0, MAX_SELECTION_SIZE);
    truncated = true;
  }
  
  // Find the message block containing the selection
  const range = selection.getRangeAt(0);
  const startNode = range.startContainer;
  const messageBlock = findMessageBlock(startNode);
  
  if (!messageBlock) {
    // Couldn't find message block - still create snippet but without anchor
    return {
      id: generateSnippetId(),
      text: finalText,
      conversationId: getConversationId(),
      projectId: getProjectIdFromUrl(window.location.href),
      sourceUrl: window.location.href,
      anchor: null,
      createdAt: Date.now(),
      truncated
    };
  }
  
  // Extract message context
  const messageId = getMessageId(messageBlock);
  const messageText = getMessageText(messageBlock);
  const conversationId = getConversationId();
  
  // Find selection offsets within message text
  const offsets = findSelectionOffsets(messageText, finalText);
  const selectionStart = offsets?.start ?? 0;
  const selectionEnd = offsets?.end ?? finalText.length;
  
  // Build anchor
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
    projectId: getProjectIdFromUrl(window.location.href),
    sourceUrl: window.location.href,
    anchor,
    createdAt: Date.now(),
    truncated
  };
}

/**
 * Generates a unique ID for a snippet.
 * @returns {string} Unique snippet ID
 */
function generateSnippetId() {
  return `snippet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
