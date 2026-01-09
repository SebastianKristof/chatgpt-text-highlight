---
name: ChatGPT Text Highlight Extension - Stage 1
overview: Build a Chrome/Edge extension (Manifest V3) that lets users collect text snippets from ChatGPT conversations with source navigation (transient highlight on click).
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
---

# Implementation Plan: Stage 1

## Overview

Stage 1 delivers snippet capture, persistence, and source navigation with a transient highlight on click.

## Architecture

The extension uses Manifest V3 with a content script approach:

- `manifest.json` - Extension configuration and permissions
- `content.js` - Main logic for selection, source navigation, UI, and storage
- `content.css` - Styling for overlay UI

Suggested file layout for maintainability and testability:

- `src/content/content.js` - content script entry
- `src/content/ui.js` - panel + FAB rendering
- `src/content/selection.js` - selection extraction + anchor creation
- `src/content/navigation.js` - source navigation + transient highlight
- `src/content/storage.js` - storage adapter
- `src/shared/hash.js` - text hashing utilities
- `src/shared/anchor.js` - anchor create/match helpers
- `content.css` - UI + transient highlight styles
- `tests/` - unit tests for shared helpers

## 1.1 Project Setup

- Create extension directory structure
- Initialize `manifest.json` with MV3 configuration
    - Permissions: `storage`, `activeTab`, `scripting`
    - Host permissions: `https://chat.openai.com/*`, `https://chatgpt.com/*`
    - Content script injection on document_idle
    - No keyboard shortcuts in Stage 1

## 1.2 Core Selection + Snippet Logic

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

## 1.3 State Management

- In-memory state object:
    - `items[]` - array of `{id, text, conversationId, anchor, timestamp}`
    - `panelOpen` - panel visibility state
- Functions:
    - `addCurrentSelection()` - add snippet
    - `removeItem(id)` - remove single snippet
    - `clearAll()` - remove all snippets
    - `loadFromStorage()` - hydrate state on boot
    - `persistToStorage()` - write-through on state changes

## 1.4 UI Components

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

## 1.5 Copy Functionality

- `copyAll()` - formats snippets as markdown list (`- ${text}`)
- Uses `navigator.clipboard.writeText()`
- Shows toast confirmation
- Guard for empty list with a friendly toast

## 1.6 Styling

- Fixed positioning (bottom-right)
- High z-index (999999) to overlay ChatGPT UI
- Modern, clean design matching ChatGPT aesthetic
- Responsive and mobile-friendly
- Transient highlight styling (CSS class applied briefly on source navigation)
    - Use `outline` + background tint to avoid DOM mutations that break layout
    - Auto-remove class after timeout

## 1.7 Persistence + Source Navigation

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

## Implementation Order

1. Setup project structure
2. Implement selection + anchors
3. Build basic UI
4. Add persistence + source navigation
5. Test on ChatGPT
6. Add Stage 1 unit/integration tests

## Testing Strategy

Unit tests (pure functions, no DOM):

- Use a lightweight runner (Vitest or Node + assert) with no network access
- `hashText()` returns stable hashes for identical normalized input
- `buildAnchor()` produces expected fields for known inputs
- `findMatchByPrefix()` selects the correct message when multiple candidates exist

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
- Large datasets (100+ snippets) still scroll smoothly
