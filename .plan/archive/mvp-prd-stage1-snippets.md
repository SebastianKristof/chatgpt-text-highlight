Build it as a **Chrome/Edge extension (Manifest V3)** that runs a **content script** on `chat.openai.com` (and optionally `chatgpt.com`) and injects a tiny overlay UI: “Collected (n)”. When you select text and press a hotkey (or click “+”), the extension:

1. **wraps the selected range** with a `<mark>` (so it stays highlighted)
2. **stores the snippet** in an in-page list (and optionally syncs to extension storage)
3. lets you **copy all** highlights as a clean block and **clear** them

Below is an MVP you can build in a few hours.

---

## MVP scope (what to build first)

**Must-have**

* Works on ChatGPT conversation pages
* Select text → press `Alt+H` → snippet is added
* Floating button “Collected (n)”
* Panel shows snippets (editable order optional later)
* Buttons: **Copy**, **Clear**, **Remove one**
* Highlights remain visible in the chat

**Nice-to-have**

* Auto-prefix each snippet with `Q:` or `- `
* Include a link back to the message (harder)
* Deduplicate identical snippets
* Export as Markdown

---

## Architecture

* `manifest.json` (MV3)
* `content.js` (runs in page, handles selection, highlighting, overlay UI)
* `content.css` (UI styling)
* Optional: `service_worker.js` (if you want persistence across reloads)

For your “paste back into chat” use case, you can keep everything **in-memory per tab** first. Persistence is optional.

---

## 1) `manifest.json` (MV3)

```json
{
  "manifest_version": 3,
  "name": "Chat Extractor",
  "version": "0.1.0",
  "description": "Highlight and collect snippets inside ChatGPT.",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": [
    "https://chat.openai.com/*",
    "https://chatgpt.com/*"
  ],
  "content_scripts": [
    {
      "matches": ["https://chat.openai.com/*", "https://chatgpt.com/*"],
      "js": ["content.js"],
      "css": ["content.css"],
      "run_at": "document_idle"
    }
  ],
  "commands": {
    "add_highlight": {
      "suggested_key": { "default": "Alt+H" },
      "description": "Add current selection to highlights"
    },
    "toggle_panel": {
      "suggested_key": { "default": "Alt+J" },
      "description": "Toggle highlights panel"
    }
  }
}
```

Note: MV3 `commands` events are normally handled by the service worker, but you can also just do **keydown listeners in the page** (simpler). I’ll show the simplest approach next.

---

## 2) Core logic: selection → wrap with `<mark>` → store snippet

### Key constraints

* Selections can span multiple nodes; wrapping is tricky.
* MVP: handle “simple selections” inside a single text node first.
* For more robust handling: use `Range.extractContents()` and reinsert.

Here’s a pragmatic MVP wrapper that works well for most paragraph-level selections:

```js
// content.js
(() => {
  const state = {
    items: [], // { id, text }
    panelOpen: false
  };

  const HIGHLIGHT_ATTR = "data-chat-extractor-highlight";

  function getSelectionText() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return "";
    return sel.toString().trim();
  }

  function wrapSelectionWithMark() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;

    // Prevent highlighting inside our own UI
    if (range.commonAncestorContainer?.nodeType === 1) {
      const el = range.commonAncestorContainer;
      if (el.closest && el.closest("#ce-root")) return null;
    }

    // Create <mark> wrapper
    const mark = document.createElement("mark");
    mark.setAttribute(HIGHLIGHT_ATTR, "1");
    mark.className = "ce-mark";

    // Extract selected contents, wrap, reinsert
    const contents = range.extractContents();
    mark.appendChild(contents);
    range.insertNode(mark);

    // Clear selection (feels nicer)
    sel.removeAllRanges();

    return mark;
  }

  function addCurrentSelection() {
    const text = getSelectionText();
    if (!text) return;

    // Wrap in page so it stays highlighted
    wrapSelectionWithMark();

    // Store
    state.items.push({ id: crypto.randomUUID(), text });
    render();
  }

  function removeItem(id) {
    state.items = state.items.filter(x => x.id !== id);
    render();
  }

  async function copyAll() {
    const out = state.items.map(x => `- ${x.text}`).join("\n\n");
    await navigator.clipboard.writeText(out);
    toast("Copied highlights to clipboard");
  }

  function clearAll() {
    state.items = [];
    // Optional: also remove marks from page
    document.querySelectorAll(`mark[${HIGHLIGHT_ATTR}="1"]`).forEach(m => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
    render();
  }

  // --- UI ---
  function ensureUI() {
    if (document.getElementById("ce-root")) return;

    const root = document.createElement("div");
    root.id = "ce-root";

    root.innerHTML = `
      <button id="ce-fab" type="button" title="Chat Extractor">Collected (0)</button>
      <div id="ce-panel" class="ce-hidden">
        <div class="ce-header">
          <div class="ce-title">Chat Extractor</div>
          <div class="ce-actions">
            <button id="ce-copy" type="button">Copy</button>
            <button id="ce-clear" type="button">Clear</button>
            <button id="ce-close" type="button">×</button>
          </div>
        </div>
        <div id="ce-list" class="ce-list"></div>
        <div class="ce-footer">
          <div class="ce-hint">Select text and press Alt+H</div>
        </div>
      </div>
      <div id="ce-toast" class="ce-toast ce-hidden"></div>
    `;

    document.documentElement.appendChild(root);

    // Handlers
    root.querySelector("#ce-fab").addEventListener("click", togglePanel);
    root.querySelector("#ce-close").addEventListener("click", togglePanel);
    root.querySelector("#ce-copy").addEventListener("click", copyAll);
    root.querySelector("#ce-clear").addEventListener("click", clearAll);
  }

  function togglePanel() {
    state.panelOpen = !state.panelOpen;
    render();
  }

  function render() {
    ensureUI();

    const fab = document.getElementById("ce-fab");
    const panel = document.getElementById("ce-panel");
    const list = document.getElementById("ce-list");

    fab.textContent = `Collected (${state.items.length})`;

    panel.classList.toggle("ce-hidden", !state.panelOpen);

    list.innerHTML = state.items.map(item => `
      <div class="ce-item">
        <div class="ce-text">${escapeHtml(item.text)}</div>
        <button class="ce-remove" data-id="${item.id}" title="Remove">Remove</button>
      </div>
    `).join("");

    list.querySelectorAll(".ce-remove").forEach(btn => {
      btn.addEventListener("click", () => removeItem(btn.dataset.id));
    });
  }

  function toast(msg) {
    const t = document.getElementById("ce-toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.remove("ce-hidden");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => t.classList.add("ce-hidden"), 1200);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  // Hotkeys (simple + reliable)
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "h") {
      e.preventDefault();
      addCurrentSelection();
    }
    if (e.altKey && e.key.toLowerCase() === "j") {
      e.preventDefault();
      togglePanel();
    }
  });

  // Start
  render();
})();
```

---

## 3) Minimal CSS for a clean overlay

```css
/* content.css */
#ce-root {
  position: fixed;
  z-index: 999999;
  right: 16px;
  bottom: 16px;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
}

#ce-fab {
  padding: 10px 12px;
  border-radius: 999px;
  border: 1px solid rgba(0,0,0,.15);
  background: rgba(255,255,255,.95);
  box-shadow: 0 6px 18px rgba(0,0,0,.12);
  cursor: pointer;
}

#ce-panel {
  width: 360px;
  max-height: 60vh;
  margin-bottom: 10px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,.15);
  background: rgba(255,255,255,.98);
  box-shadow: 0 10px 30px rgba(0,0,0,.18);
  overflow: hidden;
}

.ce-hidden { display: none; }

.ce-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0,0,0,.08);
}

.ce-title { font-weight: 600; }

.ce-actions button {
  margin-left: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,.12);
  background: white;
  cursor: pointer;
}

.ce-list {
  padding: 10px 12px;
  overflow: auto;
  max-height: 48vh;
}

.ce-item {
  border: 1px solid rgba(0,0,0,.08);
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 10px;
}

.ce-text {
  font-size: 13px;
  line-height: 1.35;
  white-space: pre-wrap;
}

.ce-remove {
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,.12);
  background: white;
  cursor: pointer;
}

.ce-footer {
  padding: 8px 12px;
  border-top: 1px solid rgba(0,0,0,.08);
  font-size: 12px;
  opacity: .75;
}

.ce-toast {
  position: fixed;
  right: 16px;
  bottom: 72px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(0,0,0,.15);
  background: rgba(0,0,0,.85);
  color: white;
  font-size: 12px;
}

.ce-mark {
  border-radius: 4px;
  padding: 0 2px;
}
```

---

## 4) Install & test locally

1. Create a folder `chat-extractor/`
2. Put: `manifest.json`, `content.js`, `content.css`
3. Chrome/Edge → `chrome://extensions`
4. Enable **Developer mode**
5. **Load unpacked** → select folder
6. Open a ChatGPT conversation
7. Select text → press `Alt+H`

---

## Hard parts you’ll hit (and how to handle them)

### 1) ChatGPT DOM changes

ChatGPT UI changes. Your UI injection should be independent. The selection + range wrap method is mostly resilient.

### 2) Highlighting across multiple paragraphs

The `extractContents()` approach already handles a lot, but can still produce odd markup if the selection crosses complex nodes.

If this becomes annoying, you can switch strategy:

* Don’t wrap DOM at all (no persistent highlight)
* Instead store `text + context` only
  That’s more stable, but you lose “visible highlights”.

A good compromise:

* Keep `<mark>` wrapping
* Add a “don’t mark page, only collect” setting

### 3) Persistence across reloads

Optional next step:

* Save `state.items` in `chrome.storage.local` keyed by URL + conversation id (you can derive it from pathname)
* On load, restore list
* You may choose not to restore DOM marks (only list)

---

## Next iteration that makes it feel “native”

If you want it to feel like it belongs in ChatGPT:

* Put a small “+” button that appears near the selection (selection tooltip)
* Or add an icon in the right gutter of each assistant message (“save this message”)

Those are 1–2 more evenings, but MVP first.

---
