## STAGE 2: Stars + Unified Local Retrieval

### Objective

Add persistent **conversation-level** and **message-level** bookmarking (“stars”) and expose a **single local search surface** that retrieves across:

* collected text snippets (Stage 1),
* starred messages,
* starred conversations.

Primary goal: deterministic next-day retrieval.
Secondary goal: minimal UI, maximal signal.

---

## Functional Additions

### 1. Star Conversation

* Inject ⭐ toggle into conversation header.
* On star:

  * Resolve `conversationId` from URL.
  * Read visible conversation title.
  * Persist record in local storage.
* On unstar:

  * Remove record and de-index.

```ts
StarredConversation {
  conversationId: string
  title: string
  summary?: string   // user-authored, optional
  tags?: string[]
  starredAt: number
}
```

---

### 2. Star Message (Assistant + User)

* Inject ⭐ button into each message action area.
* On click:

  * Snapshot full message text (`innerText`).
  * Compute `textHash = sha256(text)`.
  * Persist independently of DOM stability.

```ts
StarredMessage {
  id: uuid
  conversationId: string
  role: "assistant" | "user"
  text: string
  textHash: string
  summary?: string
  tags?: string[]
  starredAt: number
}
```

Do **not** rely on DOM IDs for persistence.

---

### 3. Conversation Summary (Optional, Manual)

* On starring a conversation, prompt once:

  * “Add 1-line description (optional)”
* Constraints:

  * single line
  * max ~140 chars
* Store verbatim.
* No auto-generation in Stage 2.

Purpose: user-aligned semantic label for search ranking.

---

## Unified Search Layer

### Index Scope

Index **all saved artifacts**:

* Snippets (Stage 1)
* Starred messages
* Starred conversations

Each artifact becomes a flat searchable document.

```ts
SearchDoc {
  id: string
  source: "snippet" | "message" | "conversation"
  conversationId?: string
  title?: string
  summary?: string
  text?: string
  tags?: string[]
  timestamp: number
}
```

### Search Text Composition

```ts
searchText =
  title +
  "\n" +
  summary +
  "\n" +
  text +
  "\n" +
  tags.join(" ")
```

---

### Search Engine

* Local-only
* Use MiniSearch or FlexSearch
* Token-based, case-insensitive
* No embeddings, no remote calls

Re-index on:

* add
* update
* delete

---

## UI Surface

### Entry

* Floating button: `Saved (n)`
* Hotkey (e.g. Alt+S)

### Panel

* Search input
* Type filters:

  * All
  * Snippets
  * Messages
  * Conversations
* Result row:

  * icon by type
  * title or first line
  * summary (if exists)
  * timestamp
  * actions: Open | Copy

---

## Navigation Semantics

### Open Conversation

* Open conversation URL in new tab.
* If source == message/snippet:

  * Attempt in-page text match via `textHash` or prefix.
  * Scroll if match found.
  * Fail silently otherwise.

Exact scroll is best-effort only.

---

## Storage

* `chrome.storage.local`
* No cross-device sync
* No background history crawling

Keyed by:

* conversationId
* artifact id

---

## Non-Goals (Explicit)

* Semantic search
* Automatic summarization
* Conversation history indexing
* Cross-session DOM reconciliation
* Cloud persistence

---

## Completion Criteria

* User can retrieve any starred insight or thread with ≤5 keystrokes.
* Search works without opening ChatGPT history.
* Zero regression to Stage 1 snippet workflow.

