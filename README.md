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

Active runtime source of truth is root `content.js` (monolith). The modular `src/` experiment is archived in `archive/src-modular-draft/` for reference.

### Building for Production

To create a minified production build:

```bash
npm run build
```

This will:
- Minify `content.js` and `content.css`
- Copy `manifest.json` and icons
- Output everything to the `dist/` directory

The `dist/` folder contains the production-ready extension that you can load into Chrome/Edge or package for the Chrome Web Store.

### Release Artifacts

Use automated release commands to keep versions in sync and generate versioned zip files:

```bash
# Keep current version, run tests/build, create zip
npm run release:zip

# Bump, release, commit, and tag
npm run release:patch
npm run release:minor
npm run release:major

# Set an explicit version
npm run release:set -- 1.2.3
```

Each release command:
- Ensures `package.json` and `manifest.json` versions stay aligned
- Updates `package-lock.json` version metadata
- Runs `npm test`
- Runs `npm run build`
- Creates `release/gpt-snippets-vX.Y.Z.zip`
- Updates `dist.zip` as the latest artifact

For `release:patch`, `release:minor`, `release:major`, and `release:set`, the script also:
- Requires a clean git working tree before release
- Creates commit `chore(release): vX.Y.Z`
- Creates annotated git tag `vX.Y.Z`

### Icons

Icons are included in the `icons/` directory. They feature a simple design with a green highlight bar matching the extension's color scheme.

### Project Structure

```
├── manifest.json                   # Extension manifest
├── content.js                      # Active content script source (monolith)
├── content.css                     # UI styles
├── archive/src-modular-draft/      # Archived modular prototype
└── tests/                          # Unit tests
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
