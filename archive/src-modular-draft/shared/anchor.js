/**
 * Anchor creation and matching utilities for source navigation.
 */

import { hashText } from './hash.js';

/**
 * Creates an anchor object from selection context.
 * @param {Object} params
 * @param {string} params.conversationId - Conversation ID from URL
 * @param {string|null} params.messageId - Message ID from DOM if available
 * @param {string} params.messageText - Full message text for hashing
 * @param {string} params.selectionText - Selected text
 * @param {number} params.selectionStart - Start offset in message text
 * @param {number} params.selectionEnd - End offset in message text
 * @returns {Object} Anchor object
 */
export function buildAnchor({ conversationId, messageId, messageText, selectionText, selectionStart, selectionEnd }) {
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

/**
 * Finds the start and end offsets of selection text within message text.
 * Best-effort matching that handles whitespace normalization.
 * @param {string} messageText - Full message text
 * @param {string} selectionText - Selected text to locate
 * @returns {{start: number, end: number}|null} Offsets or null if not found
 */
export function findSelectionOffsets(messageText, selectionText) {
  if (!selectionText || !messageText) return null;
  
  // Normalize both texts for matching (collapse whitespace)
  const normalizedMessage = messageText.replace(/\s+/g, ' ');
  const normalizedSelection = selectionText.trim().replace(/\s+/g, ' ');
  
  const index = normalizedMessage.indexOf(normalizedSelection);
  if (index === -1) {
    // Fallback: try to find a substring match
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
