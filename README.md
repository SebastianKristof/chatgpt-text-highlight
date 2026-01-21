# ChatGPT Text Highlight Extension

A Chrome/Edge extension (Manifest V3) that lets you collect text snippets from ChatGPT conversations with source navigation.

## Features (Stage 1)

- **Text Selection**: Select any text in ChatGPT conversations to save as a snippet
- **Source Navigation**: Click a snippet to navigate back to its source with a transient highlight
- **Persistent Storage**: Snippets are saved locally and persist across page reloads
- **Copy to Clipboard**: Copy all snippets as a markdown-formatted list
- **Clean UI**: Floating action button and panel overlay that doesn't interfere with ChatGPT

## Installation

1. Clone this repository
2. Open Chrome/Edge and navigate to `chrome://extensions/` (or `edge://extensions/`)
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the extension directory

## Development

The extension uses ES6 modules. Chrome/Edge Manifest V3 supports ES modules in content scripts, so the extension should work directly without a bundler. However, for production, you may want to use a bundler (like Vite or Rollup) for better performance and smaller bundle sizes.

### Icons

Icons are included in the `icons/` directory. They feature a simple design with a green highlight bar matching the extension's color scheme.

### Project Structure

```
├── manifest.json          # Extension manifest
├── content.css            # UI styles
├── src/
│   ├── content/
│   │   ├── content.js     # Main entry point
│   │   ├── selection.js   # Selection extraction
│   │   ├── navigation.js  # Source navigation
│   │   ├── storage.js     # Storage adapter
│   │   └── ui.js          # UI components
│   └── shared/
│       ├── hash.js        # Text hashing
│       └── anchor.js      # Anchor utilities
└── tests/                 # Unit tests (to be added)
```

## Usage

1. Navigate to [chatgpt.com](https://chatgpt.com) or [chat.openai.com](https://chat.openai.com)
2. Select any text in a conversation
3. The extension automatically saves it as a snippet
4. Click the "Collected (n)" button in the bottom-right to view all snippets
5. Click a snippet to navigate to its source
6. Use "Copy" to copy all snippets as markdown
7. Use "Clear" to remove all snippets

## Browser Support

- Chrome 88+ (Manifest V3)
- Edge 88+ (Manifest V3)

## Privacy

See `PRIVACY_POLICY.md`.

## License

MIT
