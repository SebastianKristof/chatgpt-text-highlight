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
 */
export async function saveSnippets(snippets) {
  try {
    const data = {
      schemaVersion: SCHEMA_VERSION,
      items: snippets
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  } catch (error) {
    console.error('Failed to save snippets:', error);
    throw error;
  }
}
