import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadStorage,
  saveStorage,
  upsertSnippet,
  removeSnippet,
  clearThread,
  clearAll
} from '../src/content/storage.js';

// Helper to create empty storage (matches internal implementation)
function createEmptyStorage() {
  return {
    schemaVersion: 2,
    snippetsById: {},
    index: {
      byThread: {},
      byProject: {},
      byTime: []
    },
    meta: {
      lastUpdatedAt: Date.now(),
      totalCount: 0
    }
  };
}

// Mock chrome.storage.local
const mockStorage = {};
const chromeMock = {
  storage: {
    local: {
      get: vi.fn((keys) => {
        const result = {};
        if (Array.isArray(keys)) {
          keys.forEach(key => {
            if (mockStorage[key] !== undefined) {
              result[key] = mockStorage[key];
            }
          });
        } else if (typeof keys === 'string') {
          if (mockStorage[keys] !== undefined) {
            result[keys] = mockStorage[keys];
          }
        } else {
          Object.keys(mockStorage).forEach(key => {
            result[key] = mockStorage[key];
          });
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((items) => {
        Object.assign(mockStorage, items);
        return Promise.resolve();
      })
    }
  },
  runtime: {
    lastError: null
  }
};

globalThis.chrome = chromeMock;

describe('createEmptyStorage', () => {
  it('creates empty v2 storage structure', () => {
    const storage = createEmptyStorage();
    expect(storage.schemaVersion).toBe(2);
    expect(storage.snippetsById).toEqual({});
    expect(storage.index.byThread).toEqual({});
    expect(storage.index.byProject).toEqual({});
    expect(storage.index.byTime).toEqual([]);
    expect(storage.meta.totalCount).toBe(0);
    expect(storage.meta.lastUpdatedAt).toBeGreaterThan(0);
  });
});

describe('loadStorage', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
    chromeMock.runtime.lastError = null;
  });

  it('creates empty storage when no data exists', async () => {
    const storage = await loadStorage();
    expect(storage.schemaVersion).toBe(2);
    expect(storage.snippetsById).toEqual({});
    expect(storage.meta.totalCount).toBe(0);
  });

  it('loads v2 storage structure', async () => {
    const v2Data = {
      schemaVersion: 2,
      snippetsById: {
        'snippet-1': {
          id: 'snippet-1',
          text: 'Test snippet',
          conversationId: 'conv-1',
          createdAt: 1000
        }
      },
      index: {
        byThread: { 'conv-1': ['snippet-1'] },
        byProject: {},
        byTime: ['snippet-1']
      },
      meta: {
        totalCount: 1,
        lastUpdatedAt: 1000
      }
    };
    mockStorage.snippets = v2Data;

    const storage = await loadStorage();
    expect(storage.schemaVersion).toBe(2);
    expect(storage.snippetsById['snippet-1']).toBeDefined();
    expect(storage.snippetsById['snippet-1'].text).toBe('Test snippet');
  });

  it('migrates v1 to v2 structure', async () => {
    const v1Data = {
      schemaVersion: 1,
      items: [
        {
          id: 'snippet-1',
          text: 'Test snippet',
          conversationId: 'conv-1',
          timestamp: 1000
        },
        {
          id: 'snippet-2',
          text: 'Another snippet',
          conversationId: 'conv-1',
          createdAt: 2000
        }
      ]
    };
    mockStorage.snippets = v1Data;

    const storage = await loadStorage();
    expect(storage.schemaVersion).toBe(2);
    expect(storage.snippetsById['snippet-1']).toBeDefined();
    expect(storage.snippetsById['snippet-1'].createdAt).toBe(1000);
    expect(storage.snippetsById['snippet-2'].createdAt).toBe(2000);
    expect(storage.index.byThread['conv-1']).toContain('snippet-1');
    expect(storage.index.byThread['conv-1']).toContain('snippet-2');
    expect(storage.meta.totalCount).toBe(2);
  });

  it('handles invalid v2 structure by creating empty storage', async () => {
    const invalidData = {
      schemaVersion: 2,
      // Missing required fields
    };
    mockStorage.snippets = invalidData;

    const storage = await loadStorage();
    expect(storage.schemaVersion).toBe(2);
    expect(storage.meta.totalCount).toBe(0);
  });

  it('handles unknown schema version by creating empty storage', async () => {
    const unknownData = {
      schemaVersion: 999,
      items: []
    };
    mockStorage.snippets = unknownData;

    const storage = await loadStorage();
    expect(storage.schemaVersion).toBe(2);
    expect(storage.meta.totalCount).toBe(0);
  });

  it('handles errors gracefully', async () => {
    chromeMock.storage.local.get.mockRejectedValueOnce(new Error('Storage error'));
    
    const storage = await loadStorage();
    expect(storage.schemaVersion).toBe(2);
    expect(storage.meta.totalCount).toBe(0);
  });
});

describe('saveStorage', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
    chromeMock.runtime.lastError = null;
  });

  it('saves storage and updates meta', async () => {
    const storage = {
      schemaVersion: 2,
      snippetsById: {
        'snippet-1': { id: 'snippet-1', text: 'Test' }
      },
      index: { byThread: {}, byProject: {}, byTime: [] },
      meta: { totalCount: 0, lastUpdatedAt: 0 }
    };

    await saveStorage(storage);

    expect(chromeMock.storage.local.set).toHaveBeenCalled();
    const savedData = mockStorage.snippets;
    expect(savedData.meta.totalCount).toBe(1);
    expect(savedData.meta.lastUpdatedAt).toBeGreaterThan(0);
  });

  it('throws user-friendly error on quota exceeded', async () => {
    chromeMock.runtime.lastError = { message: 'QUOTA_BYTES quota exceeded' };
    chromeMock.storage.local.set.mockImplementationOnce(() => {
      return Promise.resolve();
    });

    const storage = createEmptyStorage();
    await expect(saveStorage(storage)).rejects.toThrow('Storage quota exceeded');
  });
});

describe('upsertSnippet', () => {
  let storage;

  beforeEach(() => {
    storage = createEmptyStorage();
  });

  it('adds a new snippet', () => {
    const snippet = {
      id: 'snippet-1',
      text: 'Test snippet',
      conversationId: 'conv-1',
      createdAt: 1000
    };

    const updated = upsertSnippet(storage, snippet);

    expect(updated.snippetsById['snippet-1']).toBeDefined();
    expect(updated.snippetsById['snippet-1'].text).toBe('Test snippet');
    expect(updated.index.byThread['conv-1']).toContain('snippet-1');
    expect(updated.index.byTime).toContain('snippet-1');
    // Note: meta.totalCount is updated by saveStorage, not upsertSnippet
    expect(Object.keys(updated.snippetsById).length).toBe(1);
  });

  it('updates an existing snippet', () => {
    const snippet1 = {
      id: 'snippet-1',
      text: 'Original text',
      conversationId: 'conv-1',
      createdAt: 1000
    };
    storage = upsertSnippet(storage, snippet1);

    const snippet2 = {
      id: 'snippet-1',
      text: 'Updated text',
      conversationId: 'conv-1',
      createdAt: 1000
    };
    const updated = upsertSnippet(storage, snippet2);

    expect(updated.snippetsById['snippet-1'].text).toBe('Updated text');
    expect(updated.index.byThread['conv-1']).toHaveLength(1);
    // Note: meta.totalCount is updated by saveStorage, not upsertSnippet
    expect(Object.keys(updated.snippetsById).length).toBe(1);
  });

  it('moves snippet to new conversation', () => {
    const snippet1 = {
      id: 'snippet-1',
      text: 'Test',
      conversationId: 'conv-1',
      createdAt: 1000
    };
    storage = upsertSnippet(storage, snippet1);

    const snippet2 = {
      id: 'snippet-1',
      text: 'Test',
      conversationId: 'conv-2',
      createdAt: 1000
    };
    const updated = upsertSnippet(storage, snippet2);

    expect(updated.index.byThread['conv-1']).toBeUndefined();
    expect(updated.index.byThread['conv-2']).toContain('snippet-1');
  });

  it('handles project ID indexing', () => {
    const snippet = {
      id: 'snippet-1',
      text: 'Test',
      conversationId: 'conv-1',
      projectId: 'proj-1',
      createdAt: 1000
    };

    const updated = upsertSnippet(storage, snippet);

    expect(updated.index.byProject['proj-1']).toContain('snippet-1');
  });

  it('maintains byTime index sorted by createdAt desc', () => {
    const snippet1 = { id: 'snippet-1', text: 'First', conversationId: 'conv-1', createdAt: 1000 };
    const snippet2 = { id: 'snippet-2', text: 'Second', conversationId: 'conv-1', createdAt: 2000 };
    const snippet3 = { id: 'snippet-3', text: 'Third', conversationId: 'conv-1', createdAt: 1500 };

    storage = upsertSnippet(storage, snippet1);
    storage = upsertSnippet(storage, snippet2);
    storage = upsertSnippet(storage, snippet3);

    expect(storage.index.byTime).toEqual(['snippet-2', 'snippet-3', 'snippet-1']);
  });

  it('throws error if snippet has no id', () => {
    const snippet = { text: 'Test' };
    expect(() => upsertSnippet(storage, snippet)).toThrow('Snippet must have an id');
  });

  it('preserves createdAt for existing snippets', () => {
    const snippet1 = { id: 'snippet-1', text: 'Test', conversationId: 'conv-1', createdAt: 1000 };
    storage = upsertSnippet(storage, snippet1);

    const snippet2 = { id: 'snippet-1', text: 'Updated', conversationId: 'conv-1' };
    const updated = upsertSnippet(storage, snippet2);

    expect(updated.snippetsById['snippet-1'].createdAt).toBe(1000);
  });

  it('handles null conversationId (not indexed in byThread)', () => {
    const snippet = {
      id: 'snippet-1',
      text: 'Test',
      conversationId: null,
      createdAt: 1000
    };

    const updated = upsertSnippet(storage, snippet);

    expect(updated.snippetsById['snippet-1']).toBeDefined();
    // Null conversationId snippets are not added to byThread index
    expect(updated.index.byThread[null]).toBeUndefined();
    // But snippet is still in snippetsById and byTime
    expect(updated.index.byTime).toContain('snippet-1');
  });

  it('handles moving snippet between projects', () => {
    const snippet1 = {
      id: 'snippet-1',
      text: 'Test',
      conversationId: 'conv-1',
      projectId: 'proj-1',
      createdAt: 1000
    };
    storage = upsertSnippet(storage, snippet1);

    const snippet2 = {
      id: 'snippet-1',
      text: 'Test',
      conversationId: 'conv-1',
      projectId: 'proj-2',
      createdAt: 1000
    };
    const updated = upsertSnippet(storage, snippet2);

    expect(updated.index.byProject['proj-1']).toBeUndefined();
    expect(updated.index.byProject['proj-2']).toContain('snippet-1');
  });

  it('handles snippet without createdAt by using current time', () => {
    const snippet = {
      id: 'snippet-1',
      text: 'Test',
      conversationId: 'conv-1'
    };

    const updated = upsertSnippet(storage, snippet);

    expect(updated.snippetsById['snippet-1'].createdAt).toBeGreaterThan(0);
  });
});

describe('removeSnippet', () => {
  let storage;

  beforeEach(() => {
    storage = createEmptyStorage();
  });

  it('removes a snippet by ID', () => {
    const snippet = {
      id: 'snippet-1',
      text: 'Test',
      conversationId: 'conv-1',
      projectId: 'proj-1',
      createdAt: 1000
    };
    storage = upsertSnippet(storage, snippet);

    const updated = removeSnippet(storage, 'snippet-1');

    expect(updated.snippetsById['snippet-1']).toBeUndefined();
    expect(updated.index.byThread['conv-1']).toBeUndefined();
    expect(updated.index.byProject['proj-1']).toBeUndefined();
    expect(updated.index.byTime).not.toContain('snippet-1');
  });

  it('returns unchanged storage if snippet does not exist', () => {
    const original = createEmptyStorage();
    const updated = removeSnippet(original, 'non-existent');

    expect(updated).toBe(original);
  });

  it('removes empty thread from index', () => {
    const snippet = {
      id: 'snippet-1',
      text: 'Test',
      conversationId: 'conv-1',
      createdAt: 1000
    };
    storage = upsertSnippet(storage, snippet);

    const updated = removeSnippet(storage, 'snippet-1');

    expect(updated.index.byThread['conv-1']).toBeUndefined();
  });
});

describe('clearThread', () => {
  let storage;

  beforeEach(() => {
    storage = createEmptyStorage();
  });

  it('removes all snippets for a conversation', () => {
    const snippet1 = { id: 'snippet-1', text: 'Test 1', conversationId: 'conv-1', createdAt: 1000 };
    const snippet2 = { id: 'snippet-2', text: 'Test 2', conversationId: 'conv-1', createdAt: 2000 };
    const snippet3 = { id: 'snippet-3', text: 'Test 3', conversationId: 'conv-2', createdAt: 3000 };

    storage = upsertSnippet(storage, snippet1);
    storage = upsertSnippet(storage, snippet2);
    storage = upsertSnippet(storage, snippet3);

    const updated = clearThread(storage, 'conv-1');

    expect(updated.snippetsById['snippet-1']).toBeUndefined();
    expect(updated.snippetsById['snippet-2']).toBeUndefined();
    expect(updated.snippetsById['snippet-3']).toBeDefined();
    expect(updated.index.byThread['conv-1']).toBeUndefined();
  });

  it('returns unchanged storage if thread has no snippets', () => {
    const original = createEmptyStorage();
    const updated = clearThread(original, 'conv-1');

    expect(updated).toBe(original);
  });
});

describe('clearAll', () => {
  it('returns empty storage structure', () => {
    let storage = createEmptyStorage();
    const snippet = { id: 'snippet-1', text: 'Test', conversationId: 'conv-1', createdAt: 1000 };
    storage = upsertSnippet(storage, snippet);

    const cleared = clearAll(storage);

    expect(cleared.schemaVersion).toBe(2);
    expect(cleared.meta.totalCount).toBe(0);
    expect(Object.keys(cleared.snippetsById)).toHaveLength(0);
  });
});
