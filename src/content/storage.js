/**
 * Storage adapter for chrome.storage.local
 */

const STORAGE_KEY = 'snippets';
const SCHEMA_VERSION = 1;

/**
 * Loads snippets from storage.
 * @returns {Promise<Array>} Array of snippet objects
 */
export async function loadSnippets() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const data = result[STORAGE_KEY];
    
    if (!data || !Array.isArray(data.items)) {
      return [];
    }
    
    // Validate schema version
    if (data.schemaVersion !== SCHEMA_VERSION) {
      // Future: handle migration if needed
      return [];
    }
    
    return data.items;
  } catch (error) {
    console.error('Failed to load snippets:', error);
    return [];
  }
}

/**
 * Saves snippets to storage.
 * @param {Array} snippets - Array of snippet objects
 * @returns {Promise<void>}
 * @throws {Error} With user-friendly message if quota exceeded
 */
export async function saveSnippets(snippets) {
  try {
    const data = {
      schemaVersion: SCHEMA_VERSION,
      items: snippets
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
    
    // Check for quota exceeded error
    if (chrome.runtime.lastError) {
      const error = chrome.runtime.lastError;
      if (error.message && error.message.includes('quota')) {
        throw new Error('Storage quota exceeded. Please clear some snippets or export your data.');
      }
      throw new Error(error.message || 'Failed to save snippets');
    }
  } catch (error) {
    console.error('Failed to save snippets:', error);
    // Re-throw with user-friendly message if it's a quota error
    if (error.message && error.message.includes('quota')) {
      throw error;
    }
    // Check if it's a quota error by message content
    if (error.message && (error.message.includes('QUOTA_BYTES') || error.message.includes('exceeded'))) {
      throw new Error('Storage quota exceeded. Please clear some snippets or export your data.');
    }
    throw error;
  }
}
