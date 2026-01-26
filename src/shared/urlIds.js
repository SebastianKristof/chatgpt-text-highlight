/**
 * Unified URL parsing utilities for extracting conversation and project IDs.
 */

/**
 * Gets the conversation ID from a URL.
 * Supports patterns: /c/{id} or ?conversationId={id}
 * @param {string} url - URL to parse
 * @returns {string|null} Conversation ID or null if not found
 */
export function getConversationIdFromUrl(url) {
  if (!url) return null;
  
  try {
    // Try /c/{id} pattern (prefer the last match to support /g/{id}/c/{cid})
    const matches = Array.from(String(url).matchAll(/\/c\/([^/?#]+)/g));
    if (matches.length > 0) {
      return decodeURIComponent(matches[matches.length - 1][1]);
    }
    
    // Fallback: query param
    const match2 = String(url).match(/[?&]conversationId=([^&]+)/);
    if (match2) {
      return decodeURIComponent(match2[1]);
    }
  } catch (error) {
    console.warn('Failed to parse conversationId from URL:', error);
  }
  
  return null;
}

/**
 * Gets the project ID from a URL.
 * Supports patterns: /g/{id}, /g/{id}/project, /g/{id}/c/{cid}
 * @param {string} url - URL to parse
 * @returns {string|null} Project ID or null if not found
 */
export function getProjectIdFromUrl(url) {
  if (!url) return null;
  
  try {
    // Match /g/{id} pattern
    const match = String(url).match(/\/g\/([^/?#]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  } catch (error) {
    console.warn('Failed to parse projectId from URL:', error);
  }
  
  return null;
}

/**
 * Checks if a URL is a project page.
 * @param {string} url - URL to check
 * @returns {boolean} True if URL contains /g/{id} pattern
 */
export function isProjectPage(url) {
  return getProjectIdFromUrl(url) !== null;
}
