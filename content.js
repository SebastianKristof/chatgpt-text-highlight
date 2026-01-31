(() => {
  // src/content/storage.js
  var STORAGE_KEY = "snippets";
  var SCHEMA_VERSION = 2;
  function createEmptyStorage() {
    return {
      schemaVersion: SCHEMA_VERSION,
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
  function migrateV1ToV2(v1Data) {
    if (!v1Data || !Array.isArray(v1Data.items)) {
      return createEmptyStorage();
    }
    const snippetsById = {};
    const byThread = {};
    const byProject = {};
    const byTime = [];
    v1Data.items.forEach((snippet) => {
      if (!snippet || !snippet.id) {
        return;
      }
      const migratedSnippet = {
        ...snippet,
        createdAt: snippet.timestamp || snippet.createdAt || Date.now()
      };
      if (migratedSnippet.timestamp && !migratedSnippet.createdAt) {
        migratedSnippet.createdAt = migratedSnippet.timestamp;
      }
      snippetsById[snippet.id] = migratedSnippet;
      const conversationId = snippet.conversationId || null;
      if (!byThread[conversationId]) {
        byThread[conversationId] = [];
      }
      byThread[conversationId].push(snippet.id);
      byTime.push(snippet.id);
    });
    byTime.sort((id1, id2) => {
      const snippet1 = snippetsById[id1];
      const snippet2 = snippetsById[id2];
      const time1 = snippet1?.createdAt || 0;
      const time2 = snippet2?.createdAt || 0;
      return time2 - time1;
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      snippetsById,
      index: {
        byThread,
        byProject,
        byTime
      },
      meta: {
        lastUpdatedAt: Date.now(),
        totalCount: Object.keys(snippetsById).length
      }
    };
  }
  async function loadStorage() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const data = result[STORAGE_KEY];
      if (!data) {
        return createEmptyStorage();
      }
      if (data.schemaVersion === 1) {
        console.log("Migrating snippets from v1 to v2...");
        const migrated = migrateV1ToV2(data);
        try {
          await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
          console.log("Migration completed successfully");
        } catch (error) {
          console.error("Failed to save migrated data:", error);
        }
        return migrated;
      }
      if (data.schemaVersion === SCHEMA_VERSION) {
        if (!data.snippetsById || !data.index) {
          console.warn("Invalid v2 structure, creating empty storage");
          return createEmptyStorage();
        }
        if (!data.index.byProject) {
          data.index.byProject = {};
        }
        return data;
      }
      console.warn(`Unknown schema version: ${data.schemaVersion}, creating empty storage`);
      return createEmptyStorage();
    } catch (error) {
      console.error("Failed to load storage:", error);
      return createEmptyStorage();
    }
  }
  async function saveStorage(storage) {
    try {
      storage.meta = {
        ...storage.meta,
        lastUpdatedAt: Date.now(),
        totalCount: Object.keys(storage.snippetsById || {}).length
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: storage });
      if (chrome.runtime.lastError) {
        const error = chrome.runtime.lastError;
        if (error.message && error.message.includes("quota")) {
          throw new Error("Storage quota exceeded. Please clear some snippets or export your data.");
        }
        throw new Error(error.message || "Failed to save storage");
      }
    } catch (error) {
      console.error("Failed to save storage:", error);
      if (error.message && error.message.includes("quota")) {
        throw error;
      }
      if (error.message && (error.message.includes("QUOTA_BYTES") || error.message.includes("exceeded"))) {
        throw new Error("Storage quota exceeded. Please clear some snippets or export your data.");
      }
      throw error;
    }
  }
  function upsertSnippet(storage, snippet) {
    if (!snippet || !snippet.id) {
      throw new Error("Snippet must have an id");
    }
    const snippetsById = { ...storage.snippetsById };
    const index = {
      byThread: { ...storage.index.byThread },
      byProject: { ...storage.index.byProject },
      byTime: [...storage.index.byTime]
    };
    const existingSnippet = snippetsById[snippet.id];
    const oldConversationId = existingSnippet?.conversationId || null;
    const newConversationId = snippet.conversationId || null;
    const oldProjectId = existingSnippet?.projectId || null;
    const newProjectId = snippet.projectId || null;
    if (!snippet.createdAt) {
      snippet.createdAt = existingSnippet?.createdAt || Date.now();
    }
    snippetsById[snippet.id] = { ...snippet };
    if (oldConversationId !== newConversationId) {
      if (oldConversationId !== null && index.byThread[oldConversationId]) {
        index.byThread[oldConversationId] = index.byThread[oldConversationId].filter((id) => id !== snippet.id);
        if (index.byThread[oldConversationId].length === 0) {
          delete index.byThread[oldConversationId];
        }
      }
      if (newConversationId !== null) {
        if (!index.byThread[newConversationId]) {
          index.byThread[newConversationId] = [];
        }
        if (!index.byThread[newConversationId].includes(snippet.id)) {
          index.byThread[newConversationId].push(snippet.id);
        }
      }
    } else if (newConversationId !== null && !index.byThread[newConversationId]) {
      index.byThread[newConversationId] = [snippet.id];
    } else if (newConversationId !== null && !index.byThread[newConversationId].includes(snippet.id)) {
      index.byThread[newConversationId].push(snippet.id);
    }
    if (oldProjectId !== newProjectId) {
      if (oldProjectId !== null && index.byProject[oldProjectId]) {
        index.byProject[oldProjectId] = index.byProject[oldProjectId].filter((id) => id !== snippet.id);
        if (index.byProject[oldProjectId].length === 0) {
          delete index.byProject[oldProjectId];
        }
      }
      if (newProjectId !== null) {
        if (!index.byProject[newProjectId]) {
          index.byProject[newProjectId] = [];
        }
        if (!index.byProject[newProjectId].includes(snippet.id)) {
          index.byProject[newProjectId].push(snippet.id);
        }
      }
    } else if (newProjectId !== null && !index.byProject[newProjectId]) {
      index.byProject[newProjectId] = [snippet.id];
    } else if (newProjectId !== null && !index.byProject[newProjectId].includes(snippet.id)) {
      index.byProject[newProjectId].push(snippet.id);
    }
    const timeIndex = index.byTime.indexOf(snippet.id);
    if (timeIndex !== -1) {
      index.byTime.splice(timeIndex, 1);
    }
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
  function removeSnippet(storage, id) {
    const snippet = storage.snippetsById[id];
    if (!snippet) {
      return storage;
    }
    const snippetsById = { ...storage.snippetsById };
    delete snippetsById[id];
    const index = {
      byThread: { ...storage.index.byThread },
      byProject: { ...storage.index.byProject },
      byTime: [...storage.index.byTime]
    };
    const conversationId = snippet.conversationId || null;
    if (conversationId !== null && index.byThread[conversationId]) {
      index.byThread[conversationId] = index.byThread[conversationId].filter((sid) => sid !== id);
      if (index.byThread[conversationId].length === 0) {
        delete index.byThread[conversationId];
      }
    }
    const projectId = snippet.projectId || null;
    if (projectId !== null && index.byProject[projectId]) {
      index.byProject[projectId] = index.byProject[projectId].filter((sid) => sid !== id);
      if (index.byProject[projectId].length === 0) {
        delete index.byProject[projectId];
      }
    }
    index.byTime = index.byTime.filter((sid) => sid !== id);
    return {
      ...storage,
      snippetsById,
      index
    };
  }
  function clearAll(storage) {
    return createEmptyStorage();
  }

  // src/shared/hash.js
  function hashText(text) {
    if (!text) return "";
    const normalized = text.trim().replace(/\s+/g, " ");
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  // src/shared/anchor.js
  function buildAnchor({ conversationId, messageId, messageText, selectionText, selectionStart, selectionEnd }) {
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
  function findSelectionOffsets(messageText, selectionText) {
    if (!selectionText || !messageText) return null;
    const normalizedMessage = messageText.replace(/\s+/g, " ");
    const normalizedSelection = selectionText.trim().replace(/\s+/g, " ");
    const index = normalizedMessage.indexOf(normalizedSelection);
    if (index === -1) {
      const firstWords = normalizedSelection.split(" ").slice(0, 3).join(" ");
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

  // src/shared/urlIds.js
  function getConversationIdFromUrl(url) {
    if (!url) return null;
    try {
      const matches = Array.from(String(url).matchAll(/\/c\/([^/?#]+)/g));
      if (matches.length > 0) {
        return decodeURIComponent(matches[matches.length - 1][1]);
      }
      const match2 = String(url).match(/[?&]conversationId=([^&]+)/);
      if (match2) {
        return decodeURIComponent(match2[1]);
      }
    } catch (error) {
      console.warn("Failed to parse conversationId from URL:", error);
    }
    return null;
  }
  function getProjectIdFromUrl(url) {
    if (!url) return null;
    try {
      const match = String(url).match(/\/g\/([^/?#]+)/);
      if (match) {
        return decodeURIComponent(match[1]);
      }
    } catch (error) {
      console.warn("Failed to parse projectId from URL:", error);
    }
    return null;
  }

  // src/content/selection.js
  var MAX_SELECTION_SIZE = 1e4;
  var MIN_SELECTION_LENGTH = 3;
  function getConversationId() {
    return getConversationIdFromUrl(window.location.href);
  }
  function findMessageBlock(node) {
    if (!node) return null;
    let current = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (current) {
      if (current.hasAttribute && current.hasAttribute("data-message-id")) {
        return current;
      }
      if (current.getAttribute && current.getAttribute("data-message-author-role")) {
        return current;
      }
      if (current.className && typeof current.className === "string") {
        const className = current.className.toLowerCase();
        if (className.includes("message") || className.includes("group")) {
          let parent = current.parentElement;
          while (parent && parent !== document.body) {
            if (parent.hasAttribute && parent.hasAttribute("data-message-id")) {
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
  function getMessageId(messageBlock) {
    if (!messageBlock) return null;
    const messageId = messageBlock.getAttribute?.("data-message-id");
    return messageId || null;
  }
  function getMessageText(messageBlock) {
    if (!messageBlock) return "";
    const text = messageBlock.innerText || messageBlock.textContent || "";
    return text.trim();
  }
  function isSelectionInExtensionUI(selection) {
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    const container2 = range.commonAncestorContainer;
    const element = container2.nodeType === Node.ELEMENT_NODE ? container2 : container2.parentElement;
    if (!element) return false;
    let current = element;
    while (current && current !== document.body) {
      if (current.id === "ce-root" || current.classList?.contains("ce-extension")) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }
  function getSelectionText() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return "";
    return selection.toString().trim();
  }
  function buildSnippetFromSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }
    if (isSelectionInExtensionUI(selection)) {
      return null;
    }
    const selectionText = getSelectionText();
    if (!selectionText || selectionText.length < MIN_SELECTION_LENGTH) return null;
    let finalText = selectionText;
    let truncated = false;
    if (finalText.length > MAX_SELECTION_SIZE) {
      finalText = finalText.substring(0, MAX_SELECTION_SIZE);
      truncated = true;
    }
    const range = selection.getRangeAt(0);
    const startNode = range.startContainer;
    const messageBlock = findMessageBlock(startNode);
    if (!messageBlock) {
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
    const messageId = getMessageId(messageBlock);
    const messageText = getMessageText(messageBlock);
    const conversationId = getConversationId();
    const offsets = findSelectionOffsets(messageText, finalText);
    const selectionStart = offsets?.start ?? 0;
    const selectionEnd = offsets?.end ?? finalText.length;
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
  function generateSnippetId() {
    return `snippet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  // src/content/navigation.js
  var HIGHLIGHT_DURATION = 2500;
  function findMessageById(messageId) {
    if (!messageId) return null;
    const selector = `[data-message-id="${messageId}"]`;
    return document.querySelector(selector);
  }
  function findMessageByTextHash(textHash) {
    if (!textHash) return null;
    const messageBlocks = document.querySelectorAll("[data-message-id], [data-message-author-role]");
    for (const block of messageBlocks) {
      const messageText = (block.innerText || block.textContent || "").trim();
      const blockHash = hashText(messageText);
      if (blockHash === textHash) {
        return block;
      }
    }
    return null;
  }
  function findMessageByPrefix(selectionPrefix) {
    if (!selectionPrefix) return null;
    const normalizedPrefix = selectionPrefix.trim().toLowerCase();
    const messageBlocks = document.querySelectorAll("[data-message-id], [data-message-author-role]");
    for (const block of messageBlocks) {
      const messageText = (block.innerText || block.textContent || "").trim().toLowerCase();
      if (messageText.includes(normalizedPrefix)) {
        return block;
      }
    }
    return null;
  }
  function applyTransientHighlight(element, startOffset, endOffset) {
    if (!element) return;
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
      const nodeText = node.textContent || "";
      const normalizedNodeText = nodeText.replace(/\s+/g, " ");
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
    if (!startNode || !endNode) {
      element.classList.add("ce-highlight-transient");
      setTimeout(() => {
        element.classList.remove("ce-highlight-transient");
      }, HIGHLIGHT_DURATION);
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    try {
      const range = document.createRange();
      range.setStart(startNode, Math.min(startNodeOffset, startNode.textContent.length));
      range.setEnd(endNode, Math.min(endNodeOffset, endNode.textContent.length));
      const highlight = document.createElement("span");
      highlight.className = "ce-highlight-transient";
      highlight.textContent = range.toString();
      range.deleteContents();
      range.insertNode(highlight);
      highlight.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        if (highlight.parentNode) {
          highlight.parentNode.replaceChild(document.createTextNode(highlight.textContent), highlight);
          highlight.parentNode.normalize();
        }
      }, HIGHLIGHT_DURATION);
    } catch (error) {
      console.warn("Failed to create precise highlight, using element highlight:", error);
      element.classList.add("ce-highlight-transient");
      setTimeout(() => {
        element.classList.remove("ce-highlight-transient");
      }, HIGHLIGHT_DURATION);
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
  function navigateToSource(snippet) {
    if (!snippet || !snippet.anchor) {
      return { success: false, reason: "Snippet has no anchor information" };
    }
    const { anchor } = snippet;
    if (anchor.conversationId) {
      const currentConversationId = getConversationId2();
      if (currentConversationId && currentConversationId !== anchor.conversationId) {
        return {
          success: false,
          reason: "Source not found in current conversation. The snippet is from a different conversation."
        };
      }
    }
    let messageBlock = null;
    if (anchor.messageId) {
      messageBlock = findMessageById(anchor.messageId);
    }
    if (!messageBlock && anchor.textHash) {
      messageBlock = findMessageByTextHash(anchor.textHash);
    }
    if (!messageBlock && anchor.selectionPrefix) {
      messageBlock = findMessageByPrefix(anchor.selectionPrefix);
    }
    if (!messageBlock) {
      const currentConversationId = getConversationId2();
      if (anchor.conversationId && currentConversationId && currentConversationId === anchor.conversationId) {
        return {
          success: false,
          reason: "Source message not found. It may have been deleted or the page needs to be scrolled to load it."
        };
      }
      return {
        success: false,
        reason: "Source not found. The message may be in a different conversation or may have been deleted."
      };
    }
    if (anchor.selectionOffsets) {
      applyTransientHighlight(
        messageBlock,
        anchor.selectionOffsets.start,
        anchor.selectionOffsets.end
      );
    } else {
      messageBlock.classList.add("ce-highlight-transient");
      setTimeout(() => {
        messageBlock.classList.remove("ce-highlight-transient");
      }, HIGHLIGHT_DURATION);
      messageBlock.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return { success: true };
  }
  function getConversationId2() {
    return getConversationIdFromUrl(window.location.href);
  }

  // src/content/ui.js
  var CONTAINER_ID = "ce-root";
  function createContainer() {
    let container2 = document.getElementById(CONTAINER_ID);
    if (container2) return container2;
    container2 = document.createElement("div");
    container2.id = CONTAINER_ID;
    container2.className = "ce-extension";
    document.body.appendChild(container2);
    return container2;
  }
  function createFAB(count, onClick) {
    const fab2 = document.createElement("button");
    fab2.className = "ce-fab";
    fab2.setAttribute("aria-label", `Collected snippets: ${count}`);
    fab2.innerHTML = `
    <span class="ce-fab-text">Collected</span>
    <span class="ce-fab-count">${count}</span>
  `;
    fab2.addEventListener("click", onClick);
    return fab2;
  }
  function createPanel({ snippets, onCopy, onClear, onClose, onRemove, onSnippetClick, onManage, onToggleAutoSave, autoSaveEnabled, onToggleTheme, currentTheme, totalCount, searchQuery, onScopeChange, currentScope, currentProjectId, onSearch }) {
    const panel2 = document.createElement("div");
    panel2.className = "ce-panel";
    panel2.setAttribute("role", "dialog");
    panel2.setAttribute("aria-label", "Collected snippets");
    const header = createPanelHeader({
      onCopy,
      onClear,
      onClose,
      onManage,
      onToggleAutoSave,
      autoSaveEnabled,
      onToggleTheme,
      currentTheme,
      snippetCount: snippets.length,
      totalCount: totalCount !== void 0 ? totalCount : snippets.length,
      searchQuery: searchQuery || "",
      onSearch,
      onScopeChange,
      currentScope: currentScope || "thread",
      currentProjectId: currentProjectId || null
    });
    const list = createSnippetList({ snippets, onRemove, onSnippetClick });
    const footer = createPanelFooter();
    panel2.appendChild(header);
    panel2.appendChild(list);
    panel2.appendChild(footer);
    return panel2;
  }
  function createPanelHeader({ onCopy, onClear, onClose, onManage, onToggleAutoSave, autoSaveEnabled, onToggleTheme, currentTheme, snippetCount, totalCount, searchQuery, onSearch, onScopeChange, currentScope, currentProjectId }) {
    const header = document.createElement("div");
    header.className = "ce-panel-header";
    const titleRow = document.createElement("div");
    titleRow.className = "ce-panel-title-row";
    const title = document.createElement("h2");
    title.className = "ce-panel-title";
    if (searchQuery && searchQuery.trim() && totalCount !== void 0 && totalCount !== snippetCount) {
      title.textContent = `Collected Snippets (${snippetCount} of ${totalCount})`;
    } else {
      title.textContent = "Collected Snippets";
    }
    const closeBtn = document.createElement("button");
    closeBtn.className = "ce-btn ce-btn-icon";
    closeBtn.setAttribute("aria-label", "Close panel");
    closeBtn.innerHTML = "\xD7";
    closeBtn.addEventListener("click", onClose);
    titleRow.appendChild(title);
    titleRow.appendChild(closeBtn);
    if (onSearch) {
      const searchContainer = document.createElement("div");
      searchContainer.className = "ce-search-container";
      const searchWrapper = document.createElement("div");
      searchWrapper.className = "ce-search-wrapper";
      const searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.className = "ce-search-input";
      searchInput.placeholder = "Search snippets...";
      searchInput.value = searchQuery || "";
      searchInput.setAttribute("aria-label", "Search snippets");
      searchInput.addEventListener("input", (e) => {
        if (onSearch) {
          onSearch(e.target.value);
        }
      });
      const clearSearchBtn = document.createElement("button");
      clearSearchBtn.className = "ce-search-clear";
      clearSearchBtn.innerHTML = "\xD7";
      clearSearchBtn.setAttribute("aria-label", "Clear search");
      clearSearchBtn.title = "Clear search";
      clearSearchBtn.style.display = searchQuery && searchQuery.trim() ? "flex" : "none";
      clearSearchBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        searchInput.value = "";
        if (onSearch) {
          onSearch("");
        }
      });
      searchWrapper.appendChild(searchInput);
      searchWrapper.appendChild(clearSearchBtn);
      searchContainer.appendChild(searchWrapper);
      header.appendChild(searchContainer);
    }
    const actions = document.createElement("div");
    actions.className = "ce-panel-actions";
    if (onToggleTheme) {
      const themeIcons = { auto: "\u2699", light: "\u2600", dark: "\u{1F319}" };
      const themeLabels = { auto: "Auto", light: "Light", dark: "Dark" };
      const themeBtn = document.createElement("button");
      themeBtn.className = "ce-btn ce-btn-icon ce-btn-theme";
      themeBtn.innerHTML = themeIcons[currentTheme] || "\u2699";
      themeBtn.setAttribute("aria-label", `Theme: ${themeLabels[currentTheme] || "Auto"}`);
      themeBtn.title = `Theme: ${themeLabels[currentTheme] || "Auto"} (click to change)`;
      themeBtn.addEventListener("click", onToggleTheme);
      actions.appendChild(themeBtn);
    }
    if (onToggleAutoSave) {
      const autoSaveBtn = document.createElement("button");
      autoSaveBtn.className = "ce-btn ce-btn-secondary ce-btn-auto-save";
      autoSaveBtn.textContent = autoSaveEnabled ? "Auto-save: ON" : "Auto-save: OFF";
      autoSaveBtn.setAttribute("aria-label", `Auto-save is ${autoSaveEnabled ? "enabled" : "disabled"}`);
      autoSaveBtn.title = autoSaveEnabled ? "Click to disable auto-save" : "Click to enable auto-save";
      autoSaveBtn.addEventListener("click", onToggleAutoSave);
      actions.appendChild(autoSaveBtn);
    }
    const copyBtn = document.createElement("button");
    copyBtn.className = "ce-btn ce-btn-secondary ce-btn-copy";
    copyBtn.textContent = "Copy";
    copyBtn.setAttribute("aria-label", "Copy all snippets");
    copyBtn.addEventListener("click", onCopy);
    copyBtn.disabled = snippetCount === 0;
    const clearBtn = document.createElement("button");
    clearBtn.className = "ce-btn ce-btn-secondary ce-btn-clear";
    clearBtn.textContent = "Clear";
    clearBtn.setAttribute("aria-label", "Clear all snippets");
    clearBtn.addEventListener("click", onClear);
    clearBtn.disabled = snippetCount === 0;
    const manageBtn = document.createElement("button");
    manageBtn.className = "ce-btn ce-btn-secondary ce-btn-manage";
    manageBtn.textContent = "Import/Export";
    manageBtn.setAttribute("aria-label", "Import or export snippets");
    manageBtn.addEventListener("click", onManage);
    actions.appendChild(copyBtn);
    actions.appendChild(clearBtn);
    actions.appendChild(manageBtn);
    header.appendChild(titleRow);
    if (searchQuery && searchQuery.trim() && onScopeChange) {
      const scopeSelector = document.createElement("div");
      scopeSelector.className = "ce-scope-selector";
      const scopeOptions = [
        { value: "thread", label: "Thread" },
        ...currentProjectId ? [{ value: "project", label: "Project" }] : [],
        { value: "all", label: "All" }
      ];
      scopeOptions.forEach((option) => {
        const btn = document.createElement("button");
        btn.className = "ce-scope-btn";
        btn.textContent = option.label;
        btn.setAttribute("aria-label", `Filter by ${option.label}`);
        if (currentScope === option.value) {
          btn.classList.add("active");
        }
        btn.addEventListener("click", () => {
          if (onScopeChange) {
            onScopeChange(option.value);
          }
        });
        scopeSelector.appendChild(btn);
      });
      header.appendChild(scopeSelector);
    }
    header.appendChild(actions);
    return header;
  }
  function createSnippetList({ snippets, onRemove, onSnippetClick }) {
    const list = document.createElement("div");
    list.className = "ce-snippet-list";
    if (snippets.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "ce-empty-state";
      emptyState.textContent = "Select text to save a snippet";
      list.appendChild(emptyState);
      return list;
    }
    snippets.forEach((snippet, index) => {
      const item = createSnippetItem(snippet, index, onRemove, onSnippetClick);
      list.appendChild(item);
    });
    return list;
  }
  function createSnippetItem(snippet, index, onRemove, onSnippetClick) {
    const item = document.createElement("div");
    item.className = "ce-snippet-item";
    item.setAttribute("data-snippet-id", snippet.id);
    const text = document.createElement("div");
    text.className = "ce-snippet-text";
    text.textContent = snippet.text;
    text.setAttribute("title", snippet.text);
    text.style.cursor = "pointer";
    text.addEventListener("click", () => onSnippetClick(snippet));
    const meta = document.createElement("div");
    meta.className = "ce-snippet-meta";
    const timestamp = new Date(snippet.createdAt || snippet.timestamp || Date.now());
    const timeStr = timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const timeEl = document.createElement("span");
    timeEl.textContent = timeStr;
    meta.appendChild(timeEl);
    if (snippet.duplicateIndex && snippet.duplicateIndex > 1) {
      const dup = document.createElement("span");
      dup.className = "ce-duplicate-badge";
      dup.textContent = `Duplicate #${snippet.duplicateIndex}`;
      meta.appendChild(dup);
    }
    const removeBtn = document.createElement("button");
    removeBtn.className = "ce-btn ce-btn-icon ce-btn-small";
    removeBtn.setAttribute("aria-label", "Remove snippet");
    removeBtn.innerHTML = "\xD7";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onRemove(snippet.id);
    });
    item.appendChild(text);
    item.appendChild(meta);
    item.appendChild(removeBtn);
    return item;
  }
  function createPanelFooter() {
    const footer = document.createElement("div");
    footer.className = "ce-panel-footer";
    footer.textContent = "Click a snippet to navigate to its source";
    return footer;
  }
  function createImportExportModal({ snippetCount, onClose, onExportJson, onExportMarkdown, onPreview, onConfirm }) {
    const overlay = document.createElement("div");
    overlay.className = "ce-modal-overlay ce-extension";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        onClose();
      }
    });
    const modal = document.createElement("div");
    modal.className = "ce-modal ce-modal-show";
    const body = document.createElement("div");
    body.className = "ce-modal-body";
    const titleRow = document.createElement("div");
    titleRow.className = "ce-modal-title-row";
    const title = document.createElement("h3");
    title.className = "ce-modal-title";
    title.textContent = "Import / Export";
    const closeIcon = document.createElement("button");
    closeIcon.className = "ce-btn ce-btn-icon";
    closeIcon.setAttribute("aria-label", "Close import/export");
    closeIcon.innerHTML = "\xD7";
    closeIcon.addEventListener("click", onClose);
    titleRow.appendChild(title);
    titleRow.appendChild(closeIcon);
    const message = document.createElement("p");
    message.className = "ce-modal-message";
    message.textContent = "Export your snippets as JSON or Markdown, or import a JSON backup.";
    const exportSection = document.createElement("div");
    exportSection.className = "ce-modal-section";
    const exportLabel = document.createElement("div");
    exportLabel.className = "ce-modal-label";
    exportLabel.textContent = "Export";
    const exportRow = document.createElement("div");
    exportRow.className = "ce-modal-row";
    const exportJsonBtn = document.createElement("button");
    exportJsonBtn.className = "ce-btn ce-btn-secondary";
    exportJsonBtn.textContent = "Export JSON";
    exportJsonBtn.disabled = snippetCount === 0;
    exportJsonBtn.addEventListener("click", onExportJson);
    const exportMdBtn = document.createElement("button");
    exportMdBtn.className = "ce-btn ce-btn-secondary";
    exportMdBtn.textContent = "Export Markdown";
    exportMdBtn.disabled = snippetCount === 0;
    exportMdBtn.addEventListener("click", onExportMarkdown);
    exportRow.appendChild(exportJsonBtn);
    exportRow.appendChild(exportMdBtn);
    exportSection.appendChild(exportLabel);
    exportSection.appendChild(exportRow);
    const importSection = document.createElement("div");
    importSection.className = "ce-modal-section";
    const importLabel = document.createElement("div");
    importLabel.className = "ce-modal-label";
    importLabel.textContent = "Import (JSON)";
    const importRow = document.createElement("div");
    importRow.className = "ce-modal-row";
    const radioGroup = document.createElement("div");
    radioGroup.className = "ce-radio-group";
    const mergeId = `ce-import-merge-${Date.now()}`;
    const replaceId = `ce-import-replace-${Date.now()}`;
    const mergeLabel = document.createElement("label");
    mergeLabel.className = "ce-radio";
    const mergeInput = document.createElement("input");
    mergeInput.type = "radio";
    mergeInput.name = "ce-import-mode";
    mergeInput.id = mergeId;
    mergeInput.checked = true;
    mergeLabel.appendChild(mergeInput);
    mergeLabel.append("Merge (skip duplicates)");
    const replaceLabel = document.createElement("label");
    replaceLabel.className = "ce-radio";
    const replaceInput = document.createElement("input");
    replaceInput.type = "radio";
    replaceInput.name = "ce-import-mode";
    replaceInput.id = replaceId;
    replaceLabel.appendChild(replaceInput);
    replaceLabel.append("Replace existing");
    radioGroup.appendChild(mergeLabel);
    radioGroup.appendChild(replaceLabel);
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.style.display = "none";
    const chooseBtn = document.createElement("button");
    chooseBtn.className = "ce-btn ce-btn-secondary";
    chooseBtn.textContent = "Choose JSON";
    chooseBtn.addEventListener("click", () => fileInput.click());
    const fileName = document.createElement("div");
    fileName.className = "ce-file-name";
    fileName.textContent = "No file selected";
    const status = document.createElement("div");
    status.className = "ce-import-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "No import yet.";
    const setStatus = (message2, type = "info") => {
      status.textContent = message2;
      status.classList.remove("is-success", "is-error");
      if (type === "success") status.classList.add("is-success");
      if (type === "error") status.classList.add("is-error");
    };
    const preview = document.createElement("div");
    preview.className = "ce-import-preview";
    preview.textContent = "Select a JSON file to preview import.";
    const setPreview = (message2, type = "info") => {
      preview.textContent = message2;
      preview.classList.remove("is-success", "is-error");
      if (type === "success") preview.classList.add("is-success");
      if (type === "error") preview.classList.add("is-error");
    };
    let pendingImport = null;
    let lastFile = null;
    const setPending = (data) => {
      pendingImport = data;
      confirmBtn.disabled = !pendingImport;
    };
    const runPreview = () => {
      if (!lastFile) return;
      const mode = mergeInput.checked ? "merge" : "replace";
      onPreview(lastFile, mode, setStatus, setPreview, setPending);
    };
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      lastFile = file;
      fileName.textContent = file.name;
      runPreview();
      fileInput.value = "";
    });
    importRow.appendChild(chooseBtn);
    importRow.appendChild(fileName);
    importSection.appendChild(importLabel);
    importSection.appendChild(radioGroup);
    importSection.appendChild(importRow);
    importSection.appendChild(status);
    importSection.appendChild(preview);
    const actions = document.createElement("div");
    actions.className = "ce-modal-actions";
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "ce-btn ce-btn-secondary";
    confirmBtn.textContent = "Confirm import";
    confirmBtn.disabled = true;
    confirmBtn.addEventListener("click", () => {
      if (!pendingImport) return;
      const mode = mergeInput.checked ? "merge" : "replace";
      onConfirm(pendingImport, mode, setStatus, setPreview, setPending);
    });
    const closeBtn = document.createElement("button");
    closeBtn.className = "ce-btn ce-btn-secondary";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", onClose);
    actions.appendChild(confirmBtn);
    actions.appendChild(closeBtn);
    body.appendChild(titleRow);
    body.appendChild(message);
    body.appendChild(exportSection);
    body.appendChild(importSection);
    modal.appendChild(body);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    overlay.appendChild(fileInput);
    mergeInput.addEventListener("change", runPreview);
    replaceInput.addEventListener("change", runPreview);
    return overlay;
  }
  function createToast(message, duration = 3e3) {
    const toast = document.createElement("div");
    toast.className = "ce-toast";
    toast.textContent = message;
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    const container2 = document.getElementById(CONTAINER_ID) || createContainer();
    container2.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.add("ce-toast-show");
    });
    setTimeout(() => {
      toast.classList.remove("ce-toast-show");
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, duration);
    return toast;
  }
  function updateFABCount(fab2, count) {
    const countEl = fab2.querySelector(".ce-fab-count");
    if (countEl) {
      countEl.textContent = count;
    }
    fab2.setAttribute("aria-label", `Collected snippets: ${count}`);
  }
  function updatePanel(panel2, snippets, onRemove, onSnippetClick, totalCount, searchQuery, onSearch, onScopeChange, currentScope, currentProjectId) {
    const list = panel2.querySelector(".ce-snippet-list");
    if (!list) return;
    list.innerHTML = "";
    if (snippets.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "ce-empty-state";
      emptyState.textContent = searchQuery && searchQuery.trim() ? "No snippets match your search" : "Select text to save a snippet";
      list.appendChild(emptyState);
    } else {
      snippets.forEach((snippet, index) => {
        const item = createSnippetItem(snippet, index, onRemove, onSnippetClick);
        list.appendChild(item);
      });
    }
    const searchInput = panel2.querySelector(".ce-search-input");
    const clearSearchBtn = panel2.querySelector(".ce-search-clear");
    if (searchInput && searchInput.value !== (searchQuery || "")) {
      searchInput.value = searchQuery || "";
    }
    if (clearSearchBtn) {
      clearSearchBtn.style.display = searchQuery && searchQuery.trim() ? "flex" : "none";
    }
    const scopeSelector = panel2.querySelector(".ce-scope-selector");
    const hasSearchQuery = searchQuery && searchQuery.trim();
    console.log("[updatePanel] Scope selector check:", {
      hasSearchQuery,
      hasOnScopeChange: !!onScopeChange,
      existingScopeSelector: !!scopeSelector,
      searchQuery: searchQuery || "(empty)",
      currentScope: currentScope || "thread",
      currentProjectId: currentProjectId || null
    });
    if (hasSearchQuery && onScopeChange) {
      if (!scopeSelector) {
        const header = panel2.querySelector(".ce-panel-header");
        const searchContainer = panel2.querySelector(".ce-search-container");
        const actions = panel2.querySelector(".ce-panel-actions");
        if (header) {
          const newScopeSelector = document.createElement("div");
          newScopeSelector.className = "ce-scope-selector";
          const scopeOptions = [
            { value: "thread", label: "Thread" },
            ...currentProjectId ? [{ value: "project", label: "Project" }] : [],
            { value: "all", label: "All" }
          ];
          scopeOptions.forEach((option) => {
            const btn = document.createElement("button");
            btn.className = "ce-scope-btn";
            btn.textContent = option.label;
            btn.setAttribute("aria-label", `Filter by ${option.label}`);
            if (currentScope === option.value) {
              btn.classList.add("active");
            }
            btn.addEventListener("click", () => {
              if (onScopeChange) {
                onScopeChange(option.value);
              }
            });
            newScopeSelector.appendChild(btn);
          });
          if (searchContainer) {
            if (searchContainer.nextSibling) {
              header.insertBefore(newScopeSelector, searchContainer.nextSibling);
            } else {
              header.appendChild(newScopeSelector);
            }
          } else if (actions) {
            header.insertBefore(newScopeSelector, actions);
          } else {
            header.appendChild(newScopeSelector);
          }
          console.log("[Scope Selector] Created and inserted", {
            hasSearchContainer: !!searchContainer,
            hasActions: !!actions,
            optionsCount: scopeOptions.length,
            currentScope
          });
        }
      } else {
        const buttons = scopeSelector.querySelectorAll(".ce-scope-btn");
        buttons.forEach((btn) => {
          const btnText = btn.textContent.trim().toLowerCase();
          let btnScope = "thread";
          if (btnText === "project") btnScope = "project";
          else if (btnText === "all") btnScope = "all";
          if (currentScope === btnScope) {
            btn.classList.add("active");
          } else {
            btn.classList.remove("active");
          }
        });
      }
    } else if (scopeSelector && !hasSearchQuery) {
      scopeSelector.remove();
    }
    const title = panel2.querySelector(".ce-panel-title");
    if (title && searchQuery && searchQuery.trim() && totalCount !== void 0 && totalCount !== snippets.length) {
      title.textContent = `Collected Snippets (${snippets.length} of ${totalCount})`;
    } else if (title) {
      title.textContent = "Collected Snippets";
    }
    const copyBtn = panel2.querySelector(".ce-btn-copy");
    const clearBtn = panel2.querySelector(".ce-btn-clear");
    if (copyBtn) copyBtn.disabled = snippets.length === 0;
    if (clearBtn) clearBtn.disabled = snippets.length === 0;
  }

  // src/content/content.js
  var state = {
    storage: {
      snippetsById: {},
      index: {
        byThread: {},
        byTime: []
      },
      meta: {
        lastUpdatedAt: 0,
        totalCount: 0
      }
    },
    panelOpen: false,
    settings: {
      autoSave: true,
      // Default to auto-save enabled
      theme: "auto"
      // Default to auto (follows system)
    },
    searchQuery: "",
    searchScope: "thread",
    // 'thread', 'project', or 'all'
    sortOrder: "desc",
    // Cache for performance optimization
    cache: {
      key: null,
      currentSnippets: [],
      totalSnippets: [],
      itemsVersion: 0
    },
    // Selection cache
    selectionCache: {
      visibleIds: /* @__PURE__ */ new Set(),
      selectedVisibleCount: 0
    },
    selectedIds: /* @__PURE__ */ new Set()
  };
  var DEFAULT_THEME = "auto";
  var lastSnippetHash = null;
  var lastSnippetTime = 0;
  var DEDUPE_WINDOW_MS = 1e3;
  var container = null;
  var fab = null;
  var panel = null;
  var importExportModal = null;
  var modalOpen = false;
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
  function generateSnippetId2() {
    return `snippet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
  function snippetKey(snippet) {
    const anchor = snippet?.anchor || {};
    const offsets = anchor.selectionOffsets || {};
    return [
      hashText(snippet?.text || ""),
      snippet?.conversationId || "",
      anchor.textHash || "",
      offsets.start ?? "",
      offsets.end ?? ""
    ].join("|");
  }
  function normalizeImportedSnippet(raw) {
    if (!raw || typeof raw.text !== "string") return null;
    const text = raw.text.trim();
    if (!text) return null;
    return {
      id: typeof raw.id === "string" ? raw.id : generateSnippetId2(),
      text,
      conversationId: typeof raw.conversationId === "string" ? raw.conversationId : null,
      projectId: typeof raw.projectId === "string" ? raw.projectId : null,
      sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : null,
      anchor: raw.anchor && typeof raw.anchor === "object" ? raw.anchor : null,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now(),
      truncated: Boolean(raw.truncated)
    };
  }
  function normalizeImportedSnippets(items) {
    return items.map(normalizeImportedSnippet).filter(Boolean);
  }
  function expandImportDuplicates(items) {
    const seen = /* @__PURE__ */ new Map();
    const expanded = [];
    let duplicates = 0;
    items.forEach((snippet) => {
      const key = snippetKey(snippet);
      const count = seen.get(key) || 0;
      if (count === 0) {
        expanded.push(snippet);
      } else {
        expanded.push({
          ...snippet,
          id: generateSnippetId2(),
          duplicateIndex: count + 1
        });
        duplicates += 1;
      }
      seen.set(key, count + 1);
    });
    return { items: expanded, duplicates };
  }
  function mergeSnippets(existing, incoming) {
    const existingMap = new Map(existing.map((snippet) => [snippetKey(snippet), snippet]));
    const existingKeys = new Set(existingMap.keys());
    const seenIncoming = /* @__PURE__ */ new Set();
    const merged = [];
    let added = 0;
    let skipped = 0;
    incoming.forEach((snippet) => {
      const key = snippetKey(snippet);
      if (seenIncoming.has(key)) {
        skipped += 1;
        return;
      }
      seenIncoming.add(key);
      if (existingMap.has(key)) {
        skipped += 1;
        merged.push(existingMap.get(key));
        return;
      }
      merged.push(snippet);
      added += 1;
    });
    existing.forEach((snippet) => {
      const key = snippetKey(snippet);
      if (!seenIncoming.has(key) && existingKeys.has(key)) {
        merged.push(snippet);
      }
    });
    return { items: merged, added, skipped };
  }
  function buildMarkdownFromSnippets(snippets) {
    return snippets.map((snippet) => `- ${snippet.text}`).join("\n");
  }
  function downloadTextFile(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 0);
  }
  function exportFilename(extension) {
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    return `chatgpt-snippets-${stamp}.${extension}`;
  }
  function getCurrentProjectId() {
    return getProjectIdFromUrl(window.location.href);
  }
  function getTotalCountForConversation(conversationId) {
    if (conversationId === null) {
      return state.storage.meta.totalCount || 0;
    }
    const threadIds = state.storage.index.byThread[conversationId] || [];
    return threadIds.length;
  }
  function getAllSnippets(searchQuery = "", sortOrder = "desc") {
    const { snippetsById, index } = state.storage;
    let snippets = [];
    index.byTime.forEach((id) => {
      const snippet = snippetsById[id];
      if (snippet) {
        snippets.push(snippet);
      }
    });
    if (searchQuery && searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      snippets = snippets.filter(
        (snippet) => snippet.text && snippet.text.toLowerCase().includes(query)
      );
    }
    if (sortOrder === "asc") {
      snippets.reverse();
    }
    return snippets;
  }
  function getSnippetsForConversation(conversationId, searchQuery = "", sortOrder = "desc") {
    const { snippetsById, index } = state.storage;
    let snippets = [];
    if (conversationId === null) {
      return getAllSnippets(searchQuery, sortOrder);
    }
    const threadIds = index.byThread[conversationId] || [];
    threadIds.forEach((id) => {
      const snippet = snippetsById[id];
      if (snippet) {
        snippets.push(snippet);
      }
    });
    snippets.sort((a, b) => {
      const aTime = a.createdAt || 0;
      const bTime = b.createdAt || 0;
      return sortOrder === "desc" ? bTime - aTime : aTime - bTime;
    });
    if (searchQuery && searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      snippets = snippets.filter(
        (snippet) => snippet.text && snippet.text.toLowerCase().includes(query)
      );
    }
    return snippets;
  }
  function getSnippetsByScope(scope, searchQuery = "", sortOrder = "desc") {
    const { snippetsById, index } = state.storage;
    let snippets = [];
    if (scope === "thread") {
      const conversationId = getConversationId();
      if (conversationId === null) {
        return [];
      }
      const threadIds = index.byThread[conversationId] || [];
      threadIds.forEach((id) => {
        const snippet = snippetsById[id];
        if (snippet) {
          snippets.push(snippet);
        }
      });
      snippets.sort((a, b) => {
        const aTime = a.createdAt || 0;
        const bTime = b.createdAt || 0;
        return sortOrder === "desc" ? bTime - aTime : aTime - bTime;
      });
    } else if (scope === "project") {
      const currentProjectId = getCurrentProjectId();
      if (currentProjectId === null) {
        return getSnippetsByScope("thread", searchQuery, sortOrder);
      }
      const projectIds = index.byProject[currentProjectId] || [];
      projectIds.forEach((id) => {
        const snippet = snippetsById[id];
        if (snippet) {
          snippets.push(snippet);
        }
      });
      snippets.sort((a, b) => {
        const aTime = a.createdAt || 0;
        const bTime = b.createdAt || 0;
        return sortOrder === "desc" ? bTime - aTime : aTime - bTime;
      });
    } else {
      return getAllSnippets(searchQuery, sortOrder);
    }
    if (searchQuery && searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      snippets = snippets.filter(
        (snippet) => snippet.text && snippet.text.toLowerCase().includes(query)
      );
    }
    return snippets;
  }
  async function init() {
    container = createContainer();
    await loadState();
    applyTheme(state.settings.theme || DEFAULT_THEME);
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (state.settings.theme === "auto") {
          applyTheme("auto");
        }
      });
    }
    renderUI();
    setupEventListeners();
    const totalCount = state.storage.meta.totalCount || 0;
    if (totalCount > 0) {
      createToast(`Loaded ${totalCount} snippet${totalCount !== 1 ? "s" : ""}`);
    }
  }
  function applyTheme(theme) {
    if (!container) return;
    container.classList.remove("ce-theme-light", "ce-theme-dark");
    if (theme === "auto") {
      const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      container.classList.add(prefersDark ? "ce-theme-dark" : "ce-theme-light");
    } else {
      container.classList.add(`ce-theme-${theme}`);
    }
  }
  function getCurrentTheme() {
    return state.settings.theme || DEFAULT_THEME;
  }
  async function loadState() {
    try {
      const storage = await loadStorage();
      state.storage = storage;
      state.cache.key = null;
      state.cache.itemsVersion = 0;
      state.selectionCache.visibleIds = /* @__PURE__ */ new Set();
      state.selectionCache.selectedVisibleCount = 0;
      state.selectedIds = /* @__PURE__ */ new Set();
      const settingsResult = await chrome.storage.local.get("settings");
      if (settingsResult.settings) {
        state.settings = { ...state.settings, ...settingsResult.settings };
      }
    } catch (error) {
      console.error("Failed to load state:", error);
      createToast("Failed to load snippets");
    }
  }
  async function persistState() {
    try {
      await saveStorage(state.storage);
      state.cache.itemsVersion += 1;
      await chrome.storage.local.set({ settings: state.settings });
    } catch (error) {
      console.error("Failed to save state:", error);
      const message = error.message && error.message.includes("quota") ? "Storage full. Please clear some snippets or export your data." : "Failed to save snippets";
      createToast(message);
    }
  }
  function getCurrentConversationSnippets() {
    const conversationId = getConversationId();
    const url = window.location.href;
    const isMainPage = !url.includes("/c/") && !url.includes("conversationId=");
    const hasSearchQuery = state.searchQuery && state.searchQuery.trim();
    const cacheKey = JSON.stringify({
      conversationId,
      isMainPage,
      searchQuery: state.searchQuery || "",
      searchScope: state.searchScope || "thread",
      sortOrder: state.sortOrder || "desc",
      itemsVersion: state.cache.itemsVersion
    });
    if (state.cache.key === cacheKey && state.cache.currentSnippets.length >= 0) {
      return state.cache.currentSnippets;
    }
    let snippets = [];
    if (hasSearchQuery) {
      let scope = state.searchScope || "thread";
      if (scope === "project" && getCurrentProjectId() === null) {
        scope = "thread";
        state.searchScope = "thread";
      }
      snippets = getSnippetsByScope(scope, state.searchQuery || "", state.sortOrder || "desc");
    } else {
      if (isMainPage) {
        snippets = getAllSnippets("", state.sortOrder || "desc");
      } else if (conversationId) {
        snippets = getSnippetsForConversation(conversationId, "", state.sortOrder || "desc");
      }
    }
    state.cache.key = cacheKey;
    state.cache.currentSnippets = snippets;
    state.selectionCache.visibleIds = new Set(snippets.map((s) => s.id));
    state.selectionCache.selectedVisibleCount = snippets.filter((s) => state.selectedIds.has(s.id)).length;
    return snippets;
  }
  function renderUI() {
    const currentSnippets = getCurrentConversationSnippets();
    const conversationId = getConversationId();
    const url = window.location.href;
    const isMainPage = !url.includes("/c/") && !url.includes("conversationId=");
    let totalCount = 0;
    if (isMainPage) {
      totalCount = state.storage.meta.totalCount || 0;
    } else if (conversationId) {
      totalCount = getTotalCountForConversation(conversationId);
    }
    if (fab && fab.parentNode) {
      fab.parentNode.removeChild(fab);
    }
    fab = createFAB(totalCount, togglePanel);
    container.appendChild(fab);
    if (panel && panel.parentNode) {
      panel.parentNode.removeChild(panel);
    }
    panel = createPanel({
      snippets: currentSnippets,
      onCopy: handleCopy,
      onClear: handleClear,
      onClose: handleClose,
      onRemove: handleRemove,
      onSnippetClick: handleSnippetClick,
      onManage: handleOpenImportExport,
      onToggleAutoSave: handleToggleAutoSave,
      autoSaveEnabled: state.settings.autoSave,
      onToggleTheme: handleToggleTheme,
      currentTheme: getCurrentTheme(),
      totalCount,
      searchQuery: state.searchQuery || "",
      onSearch: handleSearch,
      onScopeChange: handleScopeChange,
      currentScope: state.searchScope || "thread",
      currentProjectId: getCurrentProjectId()
    });
    panel.classList.toggle("ce-panel-open", state.panelOpen);
    container.appendChild(panel);
  }
  function updateUI() {
    state.cache.key = null;
    const currentSnippets = getCurrentConversationSnippets();
    const conversationId = getConversationId();
    const url = window.location.href;
    const isMainPage = !url.includes("/c/") && !url.includes("conversationId=");
    let totalCount = 0;
    if (isMainPage) {
      totalCount = state.storage.meta.totalCount || 0;
    } else if (conversationId) {
      totalCount = getTotalCountForConversation(conversationId);
    }
    if (fab) {
      updateFABCount(fab, totalCount);
    }
    if (panel) {
      console.log("[updateUI] Calling updatePanel with:", {
        searchQuery: state.searchQuery || "",
        searchScope: state.searchScope || "thread",
        currentProjectId: getCurrentProjectId(),
        snippetsCount: currentSnippets.length
      });
      updatePanel(
        panel,
        currentSnippets,
        handleRemove,
        handleSnippetClick,
        totalCount,
        state.searchQuery || "",
        handleSearch,
        handleScopeChange,
        state.searchScope || "thread",
        getCurrentProjectId()
      );
    } else {
      console.warn("[updateUI] Panel not found, calling renderUI instead");
      renderUI();
    }
  }
  function setupEventListeners() {
    const debouncedHandleSelection = debounce(handleSelection, 100);
    document.addEventListener("mouseup", debouncedHandleSelection);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modalOpen) {
        handleCloseImportExport();
        return;
      }
      if (e.key === "Escape" && state.panelOpen) {
        handleClose();
      }
    });
    document.addEventListener("click", (e) => {
      if (modalOpen) return;
      if (state.panelOpen && panel && !panel.contains(e.target) && !fab.contains(e.target)) {
        handleClose();
      }
    });
  }
  function handleSelection(e) {
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
      }
      if (container && container.contains(e.target)) {
        return;
      }
      if (!state.settings.autoSave) {
        return;
      }
      const snippet = buildSnippetFromSelection();
      if (snippet && snippet.text && snippet.text.length >= 3) {
        const hash = hashText(snippet.text);
        const now = Date.now();
        if (hash === lastSnippetHash && now - lastSnippetTime < DEDUPE_WINDOW_MS) {
          return;
        }
        lastSnippetHash = hash;
        lastSnippetTime = now;
        addSnippet(snippet);
        if (snippet.truncated) {
          createToast("Snippet truncated (max 10,000 characters)");
        } else {
          createToast("Snippet saved");
        }
      }
    }, 10);
  }
  function addSnippet(snippet) {
    if (!snippet.id) {
      snippet.id = generateSnippetId2();
    }
    if (!snippet.createdAt) {
      snippet.createdAt = Date.now();
    }
    state.storage = upsertSnippet(state.storage, snippet);
    state.cache.key = null;
    state.cache.itemsVersion += 1;
    updateUI();
    persistState();
  }
  function handleRemove(id) {
    state.storage = removeSnippet(state.storage, id);
    state.selectedIds.delete(id);
    state.cache.key = null;
    state.cache.itemsVersion += 1;
    updateUI();
    persistState();
    createToast("Snippet removed");
  }
  function handleClear() {
    const totalCount = state.storage.meta.totalCount || 0;
    if (totalCount === 0) return;
    if (confirm(`Clear all ${totalCount} snippet${totalCount !== 1 ? "s" : ""}?`)) {
      state.storage = clearAll(state.storage);
      state.selectedIds.clear();
      state.selectionCache.selectedVisibleCount = 0;
      state.cache.key = null;
      state.cache.itemsVersion += 1;
      updateUI();
      persistState();
      createToast("All snippets cleared");
    }
  }
  async function handleCopy() {
    const allSnippets = getAllSnippets();
    if (allSnippets.length === 0) {
      createToast("No snippets to copy");
      return;
    }
    const markdown = buildMarkdownFromSnippets(allSnippets);
    try {
      await navigator.clipboard.writeText(markdown);
      createToast(`Copied ${allSnippets.length} snippet${allSnippets.length !== 1 ? "s" : ""} to clipboard`);
    } catch (error) {
      console.error("Failed to copy:", error);
      createToast("Failed to copy to clipboard");
    }
  }
  function handleOpenImportExport() {
    if (modalOpen) return;
    const totalCount = state.storage.meta.totalCount || 0;
    importExportModal = createImportExportModal({
      snippetCount: totalCount,
      onClose: handleCloseImportExport,
      onExportJson: handleExportJson,
      onExportMarkdown: handleExportMarkdown,
      onPreview: handlePreviewImport,
      onConfirm: handleConfirmImport
    });
    document.body.appendChild(importExportModal);
    modalOpen = true;
  }
  function handleCloseImportExport() {
    if (!importExportModal) return;
    importExportModal.remove();
    importExportModal = null;
    modalOpen = false;
  }
  function handleExportJson() {
    const allSnippets = getAllSnippets();
    if (allSnippets.length === 0) {
      createToast("No snippets to export");
      return;
    }
    const items = allSnippets.map((snippet) => {
      const exported = { ...snippet };
      if (exported.createdAt && !exported.timestamp) {
        exported.timestamp = exported.createdAt;
      }
      return exported;
    });
    const payload = {
      schemaVersion: 1,
      // Export as v1 for compatibility
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      items
    };
    downloadTextFile(exportFilename("json"), JSON.stringify(payload, null, 2), "application/json");
    createToast(`Exported ${allSnippets.length} snippet${allSnippets.length !== 1 ? "s" : ""}`);
  }
  function handleExportMarkdown() {
    const allSnippets = getAllSnippets();
    if (allSnippets.length === 0) {
      createToast("No snippets to export");
      return;
    }
    const markdown = buildMarkdownFromSnippets(allSnippets);
    downloadTextFile(exportFilename("md"), markdown, "text/markdown");
    createToast(`Exported ${allSnippets.length} snippet${allSnippets.length !== 1 ? "s" : ""}`);
  }
  async function handlePreviewImport(file, mode, setStatus, setPreview, setPending) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(items)) {
        setStatus("Invalid JSON format.", "error");
        setPreview("Preview unavailable.", "error");
        setPending(null);
        return;
      }
      const normalized = normalizeImportedSnippets(items);
      if (normalized.length === 0) {
        setStatus("No valid snippets found.", "error");
        setPreview("Preview unavailable.", "error");
        setPending(null);
        return;
      }
      const { items: expanded, duplicates } = expandImportDuplicates(normalized);
      const currentCount = state.storage.meta.totalCount || 0;
      if (mode === "replace") {
        const preview2 = `Preview: ${expanded.length} snippet${expanded.length !== 1 ? "s" : ""} will replace ${currentCount}.` + (duplicates ? ` ${duplicates} duplicate${duplicates !== 1 ? "s" : ""} in file will be labeled.` : "");
        setStatus("Preview ready.", "success");
        setPreview(preview2, "success");
        setPending({ items: expanded });
        return;
      }
      const existingSnippets = getAllSnippets();
      const { items: merged, added, skipped } = mergeSnippets(existingSnippets, expanded);
      const preview = `Preview: add ${added} new, skip ${skipped} duplicate${skipped !== 1 ? "s" : ""}. Total after import: ${merged.length}.` + (duplicates ? ` ${duplicates} duplicate${duplicates !== 1 ? "s" : ""} in file will be labeled.` : "");
      setStatus("Preview ready.", "success");
      setPreview(preview, "success");
      setPending({ items: expanded });
    } catch (error) {
      console.error("Failed to import snippets:", error);
      setStatus("Failed to read import file.", "error");
      setPreview("Preview unavailable.", "error");
      setPending(null);
    }
  }
  async function handleConfirmImport(pending, mode, setStatus, setPreview, setPending) {
    try {
      if (!pending?.items) {
        setStatus("No preview data available.", "error");
        return;
      }
      if (mode === "replace") {
        state.storage = clearAll(state.storage);
        state.selectedIds.clear();
        state.selectionCache.selectedVisibleCount = 0;
        for (const snippet of pending.items) {
          if (!snippet.createdAt) {
            snippet.createdAt = snippet.timestamp || Date.now();
          }
          state.storage = upsertSnippet(state.storage, snippet);
        }
        state.cache.key = null;
        state.cache.itemsVersion += 1;
        updateUI();
        await persistState();
        setStatus(`Imported ${pending.items.length} snippet${pending.items.length !== 1 ? "s" : ""}.`, "success");
        setPreview("Import complete. You can select another file to import.", "success");
        setPending(null);
        return;
      }
      const existingSnippets = getAllSnippets();
      const { items: merged, added, skipped } = mergeSnippets(existingSnippets, pending.items);
      state.storage = clearAll(state.storage);
      for (const snippet of merged) {
        if (!snippet.createdAt) {
          snippet.createdAt = snippet.timestamp || Date.now();
        }
        state.storage = upsertSnippet(state.storage, snippet);
      }
      state.cache.key = null;
      state.cache.itemsVersion += 1;
      updateUI();
      await persistState();
      const suffix = skipped ? ` (${skipped} duplicates skipped)` : "";
      setStatus(`Imported ${added} new snippet${added !== 1 ? "s" : ""}${suffix}.`, "success");
      setPreview("Import complete. You can select another file to import.", "success");
      setPending(null);
    } catch (error) {
      console.error("Failed to import snippets:", error);
      setStatus("Failed to import snippets.", "error");
    }
  }
  function handleSnippetClick(snippet) {
    const result = navigateToSource(snippet);
    if (!result.success) {
      createToast(result.reason || "Source not found");
    }
  }
  function togglePanel() {
    state.panelOpen = !state.panelOpen;
    if (panel) {
      panel.classList.toggle("ce-panel-open", state.panelOpen);
    }
  }
  function handleClose() {
    state.panelOpen = false;
    if (panel) {
      panel.classList.remove("ce-panel-open");
    }
  }
  async function handleToggleAutoSave() {
    state.settings.autoSave = !state.settings.autoSave;
    await persistState();
    updateUI();
    createToast(`Auto-save ${state.settings.autoSave ? "enabled" : "disabled"}`);
  }
  async function handleToggleTheme() {
    const currentTheme = getCurrentTheme();
    let nextTheme;
    if (currentTheme === "auto") {
      nextTheme = "light";
    } else if (currentTheme === "light") {
      nextTheme = "dark";
    } else {
      nextTheme = "auto";
    }
    state.settings.theme = nextTheme;
    applyTheme(nextTheme);
    await persistState();
    updateUI();
    const themeLabels = { auto: "Auto", light: "Light", dark: "Dark" };
    createToast(`Theme: ${themeLabels[nextTheme]}`);
  }
  function handleSearch(query) {
    console.log("[handleSearch] Called with query:", query);
    state.searchQuery = query || "";
    if (!state.searchQuery || !state.searchQuery.trim()) {
      state.searchScope = "thread";
    }
    state.cache.key = null;
    console.log("[handleSearch] State updated:", {
      searchQuery: state.searchQuery,
      searchScope: state.searchScope,
      hasPanel: !!panel
    });
    updateUI();
  }
  function handleScopeChange(scope) {
    if (!["thread", "project", "all"].includes(scope)) {
      return;
    }
    if (scope === "project" && getCurrentProjectId() === null) {
      scope = "thread";
    }
    state.searchScope = scope;
    state.cache.key = null;
    updateUI();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
