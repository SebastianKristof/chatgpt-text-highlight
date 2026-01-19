---
name: ChatGPT Text Highlight Extension - Stage 2
overview: Add star/bookmark functionality and unified local search across snippets, starred messages, and conversations.
todos:
  - id: stage2-storage
    content: Migrate to chrome.storage.local and implement data models for conversations, messages, snippets
    status: pending
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

# Implementation Plan: Stage 2

## Overview

Stage 2 adds starring for conversations and messages, plus a unified local search experience.

## Prerequisites

- Stage 1 snippet schema with `schemaVersion: 1` in `chrome.storage.local`
- Anchor helpers (`hashText`, `findMatchByPrefix`, message selector utilities)
- Existing UI panel patterns and toast utilities

## 2.1 Storage Layer

- Migrate from in-memory to `chrome.storage.local`
- Data structures:
    - `StarredConversation`: `{conversationId, title, summary?, tags?, starredAt}`
    - `StarredMessage`: `{id, conversationId, role, text, textHash, summary?, tags?, starredAt}`
    - `Snippet`: `{id, text, conversationId, anchor, timestamp}` (from Stage 1)
- Key storage by `conversationId` and artifact `id`
- Add a storage schema version and migration path from Stage 1
    - Read `schemaVersion`
    - If missing, default to 1 and add `schemaVersion`
    - Migrate any missing fields (e.g., ensure `conversationId` is present)

## 2.2 Conversation Starring

- Detect conversation ID from URL pattern
- Inject star toggle (⭐) into conversation header
- On star: capture title, prompt for optional summary (max 140 chars)
- Persist to storage
- Handle unstar: remove from storage and index
- Ensure the star UI reflects persisted state on reload

## 2.3 Message Starring

- Inject star button into each message (assistant + user)
- On click: capture full message text via `innerText`
- Compute `textHash = sha256(text)` for deduplication
- Dedupe rule: unique per `{conversationId, textHash}` to avoid collapsing identical replies across different conversations
- Persist independently of DOM structure
- Handle message DOM mutations (ChatGPT dynamic loading)
- Avoid duplicate star buttons by tagging injected nodes with a data attribute

## 2.4 Search Index

- Unified `SearchDoc` type:
    - `{id, source, conversationId?, title?, summary?, text?, tags?, timestamp}`
- Use MiniSearch or FlexSearch library (bundled locally; no remote scripts)
- Index composition: `title + "\n" + summary + "\n" + text + "\n" + tags.join(" ")`
- Re-index on: add, update, delete operations
- Case-insensitive, token-based search
- On load, rebuild index from storage to ensure consistency

## 2.5 Search UI

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

## 2.6 Navigation

- "Open" action: navigate to conversation URL in new tab
- For message/snippet sources: attempt in-page text match
    - Use `textHash` or text prefix matching
    - Scroll to match if found
    - Fail silently if not found

## 2.7 DOM Observation

- Monitor ChatGPT DOM for:
    - New messages (for star button injection)
    - Conversation header changes (for star toggle)
    - Message mutations (preserve starred state)
- Use MutationObserver with debouncing
- Track previously processed messages by `messageId` or a hash to avoid rework

## Testing Strategy

Unit tests (pure functions, no DOM):

- `dedupeKey(conversationId, textHash)` enforces per-conversation uniqueness
- `searchDocFromArtifact()` composes searchable text correctly
- `migrateStorage()` handles missing schema version gracefully

Integration tests (headless DOM or manual):

- Star toggle persists for conversation and rehydrates on reload
- Message star buttons inject once per message and persist
- Search index rebuilds from storage on load
- Search filters return correct types and counts
- Navigation opens correct conversation and scrolls to matched message when possible

Manual verification on live site:

- chatgpt.com and chat.openai.com star injection and persistence
- DOM mutation handling on long conversations
- Large datasets (100+ artifacts) still search quickly
