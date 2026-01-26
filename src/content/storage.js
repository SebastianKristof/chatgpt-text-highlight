/**
 * Storage adapter for chrome.storage.local
 * Schema v2: Normalized structure with snippetsById + indexes
 */

const STORAGE_KEY = 'snippets';
const SCHEMA_VERSION = 2;

/**
 * Creates an empty v2 storage structure.
 * @returns {Object} Empty v2 storage structure
 */
function createEmptyStorage() {
  return {
    schemaVersion: SCHEMA_VERSION,
    snippetsById: {},
    index: {
      byThread: {},
      byTime: []
    },
    meta: {
      lastUpdatedAt: Date.now(),
      totalCount: 0
    }
  };
}

/**
 * Migrates v1 data structure to v2.
 * @param {Object} v1Data - v1 data structure
 * @returns {Object} v2 data structure
 */
function migrateV1ToV2(v1Data) {
  if (!v1Data || !Array.isArray(v1Data.items)) {
    return createEmptyStorage();
  }

  const snippetsById = {};
  const byThread = {};
  const byTime = [];

  // Process each snippet
  v1Data.items.forEach((snippet) => {
    if (!snippet || !snippet.id) {
      return; // Skip invalid snippets
    }

    // Convert timestamp to createdAt
    const migratedSnippet = {
      ...snippet,
      createdAt: snippet.timestamp || snippet.createdAt || Date.now()
    };
    
    // Remove old timestamp if it exists (keep for backward compatibility during migration)
    if (migratedSnippet.timestamp && !migratedSnippet.createdAt) {
      migratedSnippet.createdAt = migratedSnippet.timestamp;
    }

    snippetsById[snippet.id] = migratedSnippet;

    // Index by thread
    const conversationId = snippet.conversationId || null;
    if (!byThread[conversationId]) {
      byThread[conversationId] = [];
    }
    byThread[conversationId].push(snippet.id);

    // Add to time index (will sort later)
    byTime.push(snippet.id);
  });

  // Sort byTime index by createdAt (desc)
  byTime.sort((id1, id2) => {
    const snippet1 = snippetsById[id1];
    const snippet2 = snippetsById[id2];
    const time1 = snippet1?.createdAt || 0;
    const time2 = snippet2?.createdAt || 0;
    return time2 - time1; // Descending order
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    snippetsById,
    index: {
      byThread,
      byTime
    },
    meta: {
      lastUpdatedAt: Date.now(),
      totalCount: Object.keys(snippetsById).length
    }
  };
}

/**
 * Loads storage from chrome.storage.local.
 * Automatically migrates v1 to v2 if needed.
 * @returns {Promise<Object>} v2 storage structure
 */
export async function loadStorage() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const data = result[STORAGE_KEY];

    if (!data) {
      return createEmptyStorage();
    }

    // Handle v1 migration
    if (data.schemaVersion === 1) {
      console.log('Migrating snippets from v1 to v2...');
      const migrated = migrateV1ToV2(data);
      
      // Save migrated data
      try {
        await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
        console.log('Migration completed successfully');
      } catch (error) {
        console.error('Failed to save migrated data:', error);
        // Return migrated data anyway, user can retry on next load
      }
      
      return migrated;
    }

    // Handle v2
    if (data.schemaVersion === SCHEMA_VERSION) {
      // Validate structure
      if (!data.snippetsById || !data.index) {
        console.warn('Invalid v2 structure, creating empty storage');
        return createEmptyStorage();
      }
      return data;
    }

    // Unknown schema version
    console.warn(`Unknown schema version: ${data.schemaVersion}, creating empty storage`);
    return createEmptyStorage();
  } catch (error) {
    console.error('Failed to load storage:', error);
    return createEmptyStorage();
  }
}

/**
 * Saves storage to chrome.storage.local.
 * @param {Object} storage - v2 storage structure
 * @returns {Promise<void>}
 * @throws {Error} With user-friendly message if quota exceeded
 */
export async function saveStorage(storage) {
  try {
    // Update meta
    storage.meta = {
      ...storage.meta,
      lastUpdatedAt: Date.now(),
      totalCount: Object.keys(storage.snippetsById || {}).length
    };

    await chrome.storage.local.set({ [STORAGE_KEY]: storage });

    // Check for quota exceeded error
    if (chrome.runtime.lastError) {
      const error = chrome.runtime.lastError;
      if (error.message && error.message.includes('quota')) {
        throw new Error('Storage quota exceeded. Please clear some snippets or export your data.');
      }
      throw new Error(error.message || 'Failed to save storage');
    }
  } catch (error) {
    console.error('Failed to save storage:', error);
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

/**
 * Upserts a snippet (adds or updates).
 * @param {Object} storage - v2 storage structure
 * @param {Object} snippet - Snippet object with id, text, conversationId, createdAt, etc.
 * @returns {Object} Updated storage structure
 */
export function upsertSnippet(storage, snippet) {
  if (!snippet || !snippet.id) {
    throw new Error('Snippet must have an id');
  }

  const snippetsById = { ...storage.snippetsById };
  const index = {
    byThread: { ...storage.index.byThread },
    byTime: [...storage.index.byTime]
  };

  const existingSnippet = snippetsById[snippet.id];
  const oldConversationId = existingSnippet?.conversationId || null;
  const newConversationId = snippet.conversationId || null;

  // Ensure createdAt exists
  if (!snippet.createdAt) {
    snippet.createdAt = existingSnippet?.createdAt || Date.now();
  }

  // Update snippetsById
  snippetsById[snippet.id] = { ...snippet };

  // Update byThread index if conversationId changed
  if (oldConversationId !== newConversationId) {
    // Remove from old thread
    if (oldConversationId !== null && index.byThread[oldConversationId]) {
      index.byThread[oldConversationId] = index.byThread[oldConversationId].filter(id => id !== snippet.id);
      if (index.byThread[oldConversationId].length === 0) {
        delete index.byThread[oldConversationId];
      }
    }

    // Add to new thread
    if (newConversationId !== null) {
      if (!index.byThread[newConversationId]) {
        index.byThread[newConversationId] = [];
      }
      if (!index.byThread[newConversationId].includes(snippet.id)) {
        index.byThread[newConversationId].push(snippet.id);
      }
    }
  } else if (newConversationId !== null && !index.byThread[newConversationId]) {
    // New snippet, add to thread
    index.byThread[newConversationId] = [snippet.id];
  } else if (newConversationId !== null && !index.byThread[newConversationId].includes(snippet.id)) {
    // Existing snippet but not in thread index (shouldn't happen, but handle it)
    index.byThread[newConversationId].push(snippet.id);
  }

  // Update byTime index
  const timeIndex = index.byTime.indexOf(snippet.id);
  if (timeIndex !== -1) {
    // Remove from old position
    index.byTime.splice(timeIndex, 1);
  }
  // Insert at correct position (sorted by createdAt desc)
  const createdAt = snippet.createdAt || 0;
  let insertIndex = 0;
  for (let i = 0; i < index.byTime.length; i++) {
    const otherId = index.byTime[i];
    const otherSnippet = snippetsById[otherId];
    const otherTime = otherSnippet?.createdAt || 0;
    if (createdAt < otherTime) {
      insertIndex = i + 1;
    } else {
      break;
    }
  }
  index.byTime.splice(insertIndex, 0, snippet.id);

  return {
    ...storage,
    snippetsById,
    index
  };
}

/**
 * Removes a snippet by ID.
 * @param {Object} storage - v2 storage structure
 * @param {string} id - Snippet ID
 * @returns {Object} Updated storage structure
 */
export function removeSnippet(storage, id) {
  const snippet = storage.snippetsById[id];
  if (!snippet) {
    return storage; // Already removed
  }

  const snippetsById = { ...storage.snippetsById };
  delete snippetsById[id];

  const index = {
    byThread: { ...storage.index.byThread },
    byTime: [...storage.index.byTime]
  };

  // Remove from byThread index
  const conversationId = snippet.conversationId || null;
  if (conversationId !== null && index.byThread[conversationId]) {
    index.byThread[conversationId] = index.byThread[conversationId].filter(sid => sid !== id);
    if (index.byThread[conversationId].length === 0) {
      delete index.byThread[conversationId];
    }
  }

  // Remove from byTime index
  index.byTime = index.byTime.filter(sid => sid !== id);

  return {
    ...storage,
    snippetsById,
    index
  };
}

/**
 * Clears all snippets for a specific thread.
 * @param {Object} storage - v2 storage structure
 * @param {string} conversationId - Conversation ID
 * @returns {Object} Updated storage structure
 */
export function clearThread(storage, conversationId) {
  const threadIds = storage.index.byThread[conversationId] || [];
  if (threadIds.length === 0) {
    return storage;
  }

  let updatedStorage = storage;
  threadIds.forEach(id => {
    updatedStorage = removeSnippet(updatedStorage, id);
  });

  return updatedStorage;
}

/**
 * Clears all snippets.
 * @param {Object} storage - v2 storage structure
 * @returns {Object} Empty storage structure
 */
export function clearAll(storage) {
  return createEmptyStorage();
}

// Backward compatibility: keep old function names that return arrays
// These will be removed in a future version

/**
 * @deprecated Use loadStorage() instead
 * Loads snippets from storage (returns array for backward compatibility).
 * @returns {Promise<Array>} Array of snippet objects
 */
export async function loadSnippets() {
  const storage = await loadStorage();
  return Object.values(storage.snippetsById);
}

/**
 * @deprecated Use saveStorage() with upsertSnippet() instead
 * Saves snippets to storage (for backward compatibility).
 * @param {Array} snippets - Array of snippet objects
 * @returns {Promise<void>}
 * @throws {Error} With user-friendly message if quota exceeded
 */
export async function saveSnippets(snippets) {
  let storage = createEmptyStorage();
  
  // Convert array to v2 structure
  snippets.forEach(snippet => {
    if (snippet && snippet.id) {
      // Ensure createdAt exists
      if (!snippet.createdAt) {
        snippet.createdAt = snippet.timestamp || Date.now();
      }
      storage = upsertSnippet(storage, snippet);
    }
  });

  await saveStorage(storage);
}
