---
name: ChatGPT Text Highlight Extension
overview: Build a Chrome/Edge extension (Manifest V3) that allows users to collect text snippets from ChatGPT conversations with source navigation, with Stage 2 adding star/bookmark functionality and unified local search across snippets, starred messages, and conversations.
todos:
  - id: stage1-setup
    content: "Create project structure: manifest.json, content.js, content.css with MV3 configuration"
    status: pending
  - id: stage1-selection
    content: Implement selection text extraction and snippet creation with source anchors (no persistent highlights)
    status: pending
    dependencies:
      - stage1-setup
  - id: stage1-state
    content: Build in-memory state management for snippets (add, remove, clear)
    status: pending
    dependencies:
      - stage1-setup
  - id: stage1-ui
    content: Create floating button, panel overlay, and toast notification UI components
    status: pending
    dependencies:
      - stage1-state
  - id: stage1-copy
    content: Implement copy-to-clipboard functionality with markdown formatting
    status: pending
    dependencies:
      - stage1-ui
  - id: stage1-styling
    content: Add CSS styling for overlay UI, transient highlight flash, and mobile responsiveness
    status: pending
    dependencies:
      - stage1-ui
  - id: stage1-persistence
    content: Persist snippets (with source anchors) to chrome.storage.local and rehydrate on page load
    status: pending
    dependencies:
      - stage1-copy
  - id: stage1-tests
    content: Add unit + integration tests for selection, anchors, persistence, and source navigation
    status: pending
    dependencies:
      - stage1-persistence
  - id: stage2-storage
    content: Migrate to chrome.storage.local and implement data models for conversations, messages, snippets
    status: pending
    dependencies:
      - stage1-persistence
  - id: stage2-conversation-star
    content: Add star toggle to conversation header with title capture and optional summary
    status: pending
    dependencies:
      - stage2-storage
  - id: stage2-message-star
    content: Inject star buttons into messages, capture text with hash, handle DOM mutations
    status: pending
    dependencies:
      - stage2-storage
  - id: stage2-search-index
    content: Integrate MiniSearch/FlexSearch, build unified search index across all artifacts
    status: pending
    dependencies:
      - stage2-conversation-star
      - stage2-message-star
  - id: stage2-search-ui
    content: Build search panel with filters, result rows, and navigation actions
    status: pending
    dependencies:
      - stage2-search-index
  - id: stage2-tests
    content: Add tests for starring, storage migrations, search indexing, and navigation
    status: pending
    dependencies:
      - stage2-search-ui
---

# Implementation Plan: ChatGPT Text Highlight Extension

## Overview

This plan covers building a Chrome/Edge extension in two stages:

- **Stage 1**: Text snippet collection with source navigation (transient highlight on click)
- **Stage 2**: Star/bookmark functionality with unified local search

## Architecture

The extension uses Manifest V3 with a content script approach:

- `manifest.json` - Extension configuration and permissions
- `content.js` - Main logic for selection, source navigation, UI, and search
- `content.css` - Styling for overlay UI
- Optional: `service_worker.js` - For cross-tab persistence (Stage 2)

Suggested file layout for maintainability and testability:

- `src/content/content.js` - content script entry
- `src/content/ui.js` - panel + FAB rendering
- `src/content/selection.js` - selection extraction + anchor creation
- `src/content/navigation.js` - source navigation + transient highlight
- `src/content/storage.js` - storage adapter (Stage 1 + Stage 2)
- `src/shared/hash.js` - text hashing utilities
- `src/shared/anchor.js` - anchor create/match helpers
- `content.css` - UI + transient highlight styles
- `tests/` - unit tests for shared helpers

## Stage 1: Snippet Collection (MVP)

### 1.1 Project Setup

- Create extension directory structure
- Initialize `manifest.json` with MV3 configuration
    - Permissions: `storage`, `activeTab`, `scripting`
    - Host permissions: `https://chat.openai.com/*`, `https://chatgpt.com/*`
    - Content script injection on document_idle
    - No keyboard shortcuts in Stage 1

### 1.2 Core Selection & Snippet Logic

- Implement `getSelectionText()` - extracts selected text
- Implement `buildSnippetFromSelection()` - creates a snippet with:
    - `text` (selection text)
    - `anchor` (conversationId + messageId + textHash + offsets)
    - `timestamp`
- Prevent snippet creation when selection is inside extension UI
- Handle edge cases: collapsed selections, selections across multiple nodes
- Define message block selector(s) for chatgpt.com and chat.openai.com
    - Prefer a stable container with message role markers (e.g., `data-message-id` if present)
    - Fallback to nearest message wrapper based on role labels or known structure
- Anchor creation details:
    - `conversationId`: parse from URL (`/c/{id}` or `?conversationId=...`)
    - `messageId`: from DOM attribute if available, otherwise omit
    - `textHash`: hash of full message `innerText` (trimmed, normalized whitespace)
    - `selectionOffsets`: compute by locating selection text in the message text (best-effort)
    - `selectionPrefix`: first ~32 chars of selection for fallback matching
- Limit selection size for performance (e.g., 5–10k chars) and show a toast if truncated

### 1.3 State Management

- In-memory state object:
    - `items[]` - array of `{id, text, conversationId, anchor, timestamp}`
    - `panelOpen` - panel visibility state
- Functions:
    - `addCurrentSelection()` - add snippet
    - `removeItem(id)` - remove single snippet
    - `clearAll()` - remove all snippets
    - `loadFromStorage()` - hydrate state on boot
    - `persistToStorage()` - write-through on state changes

### 1.4 UI Components

- Floating Action Button (FAB): "Collected (n)" - shows count, toggles panel
- Panel overlay:
    - Header: title, Copy/Clear/Close buttons
    - List: scrollable snippet items with Remove buttons
    - Footer: hint text
- Toast notification for copy feedback
- Ensure UI is isolated from ChatGPT DOM (use `#ce-root` container)
- Snippet row click triggers source navigation (see 1.7)
- Empty state for zero snippets ("Select text to save a snippet")
- Loading state while reading from storage (brief skeleton or spinner)

### 1.5 Copy Functionality

- `copyAll()` - formats snippets as markdown list (`- ${text}`)
- Uses `navigator.clipboard.writeText()`
- Shows toast confirmation
- Guard for empty list with a friendly toast

### 1.6 Styling

- Fixed positioning (bottom-right)
- High z-index (999999) to overlay ChatGPT UI
- Modern, clean design matching ChatGPT aesthetic
- Responsive and mobile-friendly
- Transient highlight styling (CSS class applied briefly on source navigation)
    - Use `outline` + background tint to avoid DOM mutations that break layout
    - Auto-remove class after timeout

### 1.7 Persistence + Source Navigation (Stage 1)

- Persist snippets to `chrome.storage.local`
    - Store snippets as `{id, text, conversationId, anchor, timestamp}`
    - `anchor` should be stable enough for re-finding the source message:
        - `messageId` when available
        - `textHash` of full message text
        - `selectionPrefix` (first ~32 chars of selection)
        - `selectionOffsets` within the message text (best-effort)
    - Storage key: `snippets` (array) with a schema version `schemaVersion: 1`
- Rehydrate on page load
    - Load snippets and render panel
- Source navigation on snippet click
    - Locate message by `messageId` if present
    - Fallback to `textHash` match across message blocks
    - Fallback to `selectionPrefix` search within messages
    - Scroll into view and apply a transient highlight class (2-3s) to the matched range
    - If no match found, show a non-blocking toast: "Source not found"

## Stage 2: Stars + Unified Search

### 2.1 Storage Layer

- Migrate from in-memory to `chrome.storage.local`
- Data structures:
    - `StarredConversation`: `{conversationId, title, summary?, tags?, starredAt}`
    - `StarredMessage`: `{id, conversationId, role, text, textHash, summary?, tags?, starredAt}`
    - `Snippet`: `{id, text, conversationId, anchor, timestamp}` (extend Stage 1)
- Key storage by `conversationId` and artifact `id`
- Add a storage schema version and migration path from Stage 1

### 2.2 Conversation Starring

- Detect conversation ID from URL pattern
- Inject star toggle (⭐) into conversation header
- On star: capture title, prompt for optional summary (max 140 chars)
- Persist to storage
- Handle unstar: remove from storage and index
- Ensure the star UI reflects persisted state on reload

### 2.3 Message Starring

- Inject star button into each message (assistant + user)
- On click: capture full message text via `innerText`
- Compute `textHash = sha256(text)` for deduplication
- Dedupe rule: unique per `{conversationId, textHash}` to avoid collapsing identical replies across different conversations
- Persist independently of DOM structure
- Handle message DOM mutations (ChatGPT dynamic loading)
- Avoid duplicate star buttons by tagging injected nodes with a data attribute

### 2.4 Search Index

- Unified `SearchDoc` type:
    - `{id, source, conversationId?, title?, summary?, text?, tags?, timestamp}`
- Use MiniSearch or FlexSearch library (bundled locally; no remote scripts)
- Index composition: `title + "\n" + summary + "\n" + text + "\n" + tags.join(" ")`
- Re-index on: add, update, delete operations
- Case-insensitive, token-based search
- On load, rebuild index from storage to ensure consistency

### 2.5 Search UI

- Update FAB: "Saved (n)" showing total artifacts
- Search panel:
    - Search input with live filtering
    - Type filters: All / Snippets / Messages / Conversations
    - Result rows:
        - Icon by type
        - Title or first line preview
        - Summary (if exists)
        - Timestamp
        - Actions: Open | Copy
- Hotkey: Alt+S to open search panel
- Display total counts by type in filter tabs

### 2.6 Navigation

- "Open" action: navigate to conversation URL in new tab
- For message/snippet sources: attempt in-page text match
    - Use `textHash` or text prefix matching
    - Scroll to match if found
    - Fail silently if not found

### 2.7 DOM Observation

- Monitor ChatGPT DOM for:
    - New messages (for star button injection)
    - Conversation header changes (for star toggle)
    - Message mutations (preserve starred state)
- Use MutationObserver with debouncing
- Track previously processed messages by `messageId` or a hash to avoid rework

## Implementation Order

1. **Stage 1 Core** (MVP)

    - Setup project structure
    - Implement selection + anchors
    - Build basic UI
    - Add persistence + source navigation
    - Test on ChatGPT

2. **Stage 1 Polish**

    - Improve selection handling for complex DOM
    - Add error handling
    - Mobile responsiveness
    - Edge case testing
    - Add unit/integration tests for Stage 1 helpers

3. **Stage 2 Storage**

    - Migrate to chrome.storage.local
    - Implement data models
    - Add persistence layer

4. **Stage 2 Starring**

    - Conversation star UI
    - Message star UI
    - DOM observation for dynamic content
    - Add tests for starring + storage

5. **Stage 2 Search**

    - Integrate search library
    - Build search index
    - Implement search UI
    - Add navigation logic
    - Add tests for indexing + search results

## Technical Considerations

- **DOM Stability**: ChatGPT's DOM changes frequently - use content hashing and avoid relying on DOM IDs
- **Selection Handling**: Complex selections across multiple nodes require careful Range API usage
- **Performance**: Debounce DOM observations and search indexing
- **Index Size**: Cap search index to a reasonable size or warn at high counts
- **Privacy**: All data stays local, no external API calls
- **Compatibility**: Test on both chat.openai.com and chatgpt.com domains

## Testing Strategy

Unit tests (pure functions, no DOM):

- Use a lightweight runner (Vitest or Node + assert) with no network access
- `hashText()` returns stable hashes for identical normalized input
- `buildAnchor()` produces expected fields for known inputs
- `findMatchByPrefix()` selects the correct message when multiple candidates exist
- `dedupeKey(conversationId, textHash)` enforces per-conversation uniqueness

Integration tests (headless DOM or manual):

- Use JSDOM for DOM matching and selection offset helpers where feasible
- Selection in plain text, multi-paragraph, and code blocks creates correct snippets
- Selections within extension UI do not create snippets
- Storage rehydrates snippets and renders UI after reload
- Source navigation succeeds via `messageId`, then `textHash`, then `selectionPrefix`
- Transient highlight applies and auto-clears without layout shift
- Clear all removes snippets and persists empty state
- Copy to clipboard produces a markdown list in expected order

Manual verification on live site:

- chatgpt.com and chat.openai.com message selection and navigation
- UI layering does not interfere with chat input or side panels
- Large datasets (100+ snippets) still scroll and search smoothly