globalThis.__CE_DISABLE_AUTO_INIT__ = true;
globalThis.__CE_ENABLE_TEST_API__ = true;

if (!globalThis.__CE_ACTIVE_TEST_API__) {
  await import('../content.js');
}

const api = globalThis.__CE_ACTIVE_TEST_API__;

if (!api) {
  throw new Error('Active test API not found on globalThis.__CE_ACTIVE_TEST_API__');
}

export const {
  hashText,
  buildAnchor,
  findSelectionOffsets,
  getConversationIdFromUrl,
  getProjectIdFromUrl,
  isProjectPage,
  getConversationId,
  findMessageBlock,
  getMessageId,
  getMessageText,
  isSelectionInExtensionUI,
  getSelectionText,
  buildSnippetFromSelection,
  findMessageById,
  findMessageByTextHash,
  findMessageByPrefix,
  navigateToSource,
  loadStorage,
  saveStorage,
  upsertSnippet,
  removeSnippet,
  clearThread,
  clearAll,
  shouldUseDarkTheme,
  getEffectiveTheme,
  applyTheme
} = api;
