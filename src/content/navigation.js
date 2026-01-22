/**
 * Source navigation and transient highlight functionality.
 */

import { hashText } from '../shared/hash.js';

const HIGHLIGHT_DURATION = 2500; // 2.5 seconds

/**
 * Finds a message block by message ID.
 * @param {string} messageId - Message ID to find
 * @returns {HTMLElement|null} Message element or null
 */
export function findMessageById(messageId) {
  if (!messageId) return null;
  
  const selector = `[data-message-id="${messageId}"]`;
  return document.querySelector(selector);
}

/**
 * Finds a message block by text hash.
 * @param {string} textHash - Hash of message text
 * @returns {HTMLElement|null} Message element or null
 */
export function findMessageByTextHash(textHash) {
  if (!textHash) return null;
  
  // Get all potential message blocks
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

/**
 * Finds a message block by selection prefix.
 * @param {string} selectionPrefix - First ~32 chars of selection
 * @returns {HTMLElement|null} Message element or null
 */
export function findMessageByPrefix(selectionPrefix) {
  if (!selectionPrefix) return null;
  
  const normalizedPrefix = selectionPrefix.trim().toLowerCase();
  
  // Get all potential message blocks
  const messageBlocks = document.querySelectorAll('[data-message-id], [data-message-author-role]');
  
  for (const block of messageBlocks) {
    const messageText = (block.innerText || block.textContent || '').trim().toLowerCase();
    
    if (messageText.includes(normalizedPrefix)) {
      return block;
    }
  }
  
  return null;
}

/**
 * Applies a transient highlight to a text range within an element.
 * @param {HTMLElement} element - Element containing the text
 * @param {number} startOffset - Start offset in normalized text
 * @param {number} endOffset - End offset in normalized text
 */
export function applyTransientHighlight(element, startOffset, endOffset) {
  if (!element) return;
  
  // Get the text content
  const text = (element.innerText || element.textContent || '').trim();
  const normalizedText = text.replace(/\s+/g, ' ');
  
  // Find the text node(s) containing this range
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
  
  // If we couldn't find exact nodes, highlight the whole element
  if (!startNode || !endNode) {
    element.classList.add('ce-highlight-transient');
    setTimeout(() => {
      element.classList.remove('ce-highlight-transient');
    }, HIGHLIGHT_DURATION);
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  
  // Create a range and highlight it
  try {
    const range = document.createRange();
    range.setStart(startNode, Math.min(startNodeOffset, startNode.textContent.length));
    range.setEnd(endNode, Math.min(endNodeOffset, endNode.textContent.length));
    
    // Create a temporary span for highlighting
    const highlight = document.createElement('span');
    highlight.className = 'ce-highlight-transient';
    highlight.textContent = range.toString();
    
    range.deleteContents();
    range.insertNode(highlight);
    
    // Scroll into view
    highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Remove highlight after duration
    setTimeout(() => {
      if (highlight.parentNode) {
        highlight.parentNode.replaceChild(document.createTextNode(highlight.textContent), highlight);
        highlight.parentNode.normalize();
      }
    }, HIGHLIGHT_DURATION);
  } catch (error) {
    // Fallback: highlight whole element
    console.warn('Failed to create precise highlight, using element highlight:', error);
    element.classList.add('ce-highlight-transient');
    setTimeout(() => {
      element.classList.remove('ce-highlight-transient');
    }, HIGHLIGHT_DURATION);
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/**
 * Navigates to the source of a snippet and applies transient highlight.
 * @param {Object} snippet - Snippet object with anchor
 * @returns {{success: boolean, reason?: string}} Result object with success status and optional reason
 */
export function navigateToSource(snippet) {
  if (!snippet || !snippet.anchor) {
    return { success: false, reason: 'Snippet has no anchor information' };
  }
  
  const { anchor } = snippet;
  
  // Check if we're on the right conversation
  if (anchor.conversationId) {
    const currentConversationId = getConversationId();
    if (currentConversationId && currentConversationId !== anchor.conversationId) {
      return { 
        success: false, 
        reason: 'Source not found in current conversation. The snippet is from a different conversation.' 
      };
    }
  }
  
  let messageBlock = null;
  
  // Try messageId first
  if (anchor.messageId) {
    messageBlock = findMessageById(anchor.messageId);
  }
  
  // Fallback to textHash
  if (!messageBlock && anchor.textHash) {
    messageBlock = findMessageByTextHash(anchor.textHash);
  }
  
  // Fallback to selectionPrefix
  if (!messageBlock && anchor.selectionPrefix) {
    messageBlock = findMessageByPrefix(anchor.selectionPrefix);
  }
  
  if (!messageBlock) {
    const currentConversationId = getConversationId();
    if (anchor.conversationId && currentConversationId && currentConversationId === anchor.conversationId) {
      return { 
        success: false, 
        reason: 'Source message not found. It may have been deleted or the page needs to be scrolled to load it.' 
      };
    }
    return { 
      success: false, 
      reason: 'Source not found. The message may be in a different conversation or may have been deleted.' 
    };
  }
  
  // Apply transient highlight
  if (anchor.selectionOffsets) {
    applyTransientHighlight(
      messageBlock,
      anchor.selectionOffsets.start,
      anchor.selectionOffsets.end
    );
  } else {
    // No offsets, highlight whole message
    messageBlock.classList.add('ce-highlight-transient');
    setTimeout(() => {
      messageBlock.classList.remove('ce-highlight-transient');
    }, HIGHLIGHT_DURATION);
    messageBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  
  return { success: true };
}

/**
 * Gets the conversation ID from the current URL.
 * @returns {string|null} Conversation ID or null
 */
function getConversationId() {
  const url = window.location.href;
  
  const match1 = url.match(/\/c\/([a-f0-9-]+)/);
  if (match1) return match1[1];
  
  const match2 = url.match(/[?&]conversationId=([^&]+)/);
  if (match2) return match2[1];
  
  return null;
}
