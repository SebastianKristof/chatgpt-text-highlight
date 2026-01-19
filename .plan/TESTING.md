# Testing Guide

## Quick Start

### 1. Load the Extension

1. Open Chrome and navigate to `chrome://extensions/` (or Edge: `edge://extensions/`)
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the `chatgpt-text-highlight` directory (the one containing `manifest.json`)

### 2. Icons

Icons are included, so you shouldn't see any warnings about missing icons.

### 3. Test on ChatGPT

1. Navigate to [chatgpt.com](https://chatgpt.com) or [chat.openai.com](https://chat.openai.com)
2. Start or open a conversation
3. You should see a green "Collected (0)" button in the bottom-right corner

## Test Scenarios

### Basic Selection & Snippet Creation

1. **Select text in a ChatGPT message**
   - Select any text in a conversation
   - You should see a toast notification: "Snippet saved"
   - The FAB should update to show "Collected (1)"

2. **Open the panel**
   - Click the "Collected (n)" button
   - Panel should slide up from the bottom-right
   - You should see your snippet with timestamp

3. **Create multiple snippets**
   - Select different text from the same or different messages
   - Each selection should create a new snippet
   - Count should increment

### Source Navigation

1. **Click a snippet in the panel**
   - The page should scroll to the source message
   - The selected text should flash with a green highlight for ~2.5 seconds
   - If source not found, you'll see "Source not found" toast

2. **Test with different scenarios**
   - Same conversation, same message
   - Same conversation, different message
   - After page reload (snippets should persist)

### Copy Functionality

1. **Copy all snippets**
   - Click "Copy" button in panel header
   - Should see toast: "Copied N snippets to clipboard"
   - Paste somewhere - should be markdown format: `- snippet text`

2. **Copy with empty list**
   - Clear all snippets first
   - Click "Copy" - should show "No snippets to copy"

### Remove & Clear

1. **Remove single snippet**
   - Click the × button on a snippet
   - Should see "Snippet removed" toast
   - Count should decrement

2. **Clear all**
   - Click "Clear" button
   - Should show confirmation dialog
   - After confirming, all snippets removed
   - Should see "All snippets cleared" toast

### Persistence

1. **Reload the page**
   - Create a few snippets
   - Reload the ChatGPT page (F5 or Cmd+R)
   - Snippets should still be there
   - Should see "Loaded N snippets" toast

2. **Navigate between conversations**
   - Snippets should persist across different conversations
   - Source navigation should work if you return to the original conversation

### Edge Cases

1. **Select text inside extension UI**
   - Try selecting text in the panel or FAB
   - Should NOT create a snippet

2. **Large selection**
   - Select a very long text (>10k chars)
   - Should truncate and show "Snippet truncated" toast

3. **Empty selection**
   - Just click without selecting
   - Should not create snippet

4. **Panel interactions**
   - Click outside panel should close it
   - Press Escape should close panel
   - Panel should not interfere with ChatGPT UI

## Debugging

### Check Console for Errors

1. Open DevTools (F12 or Cmd+Option+I)
2. Go to Console tab
3. Look for any errors from the extension
4. Errors will be prefixed with extension context

### Check Extension Status

1. Go to `chrome://extensions/`
2. Find "ChatGPT Text Highlight"
3. Check for any error messages
4. Click "Errors" button if shown

### Common Issues

**Extension not loading:**
- Check that `manifest.json` is valid JSON
- Ensure all file paths in manifest exist
- Check console for import errors

**ES Module errors:**
- Chrome should support ES modules, but if you see import errors, you may need a bundler
- Check that all import paths are correct

**UI not appearing:**
- Check that content script is injected (look in DevTools Sources tab)
- Verify CSS is loading
- Check z-index isn't being overridden

**Storage not working:**
- Check browser permissions
- Look for storage errors in console
- Verify `chrome.storage.local` is accessible

### Manual Code Inspection

If something's not working, you can:

1. **Inspect the extension container:**
   - Open DevTools
   - Look for `#ce-root` element in Elements tab
   - Check if it's being created

2. **Check storage:**
   - Go to `chrome://extensions/`
   - Click "Inspect views: service worker" (if available)
   - Or use Storage tab in DevTools to check `chrome.storage.local`

3. **Test individual functions:**
   - Open Console in ChatGPT page
   - Extension functions won't be directly accessible, but you can check:
     - `window.getSelection()` - should work
     - Check if `#ce-root` exists: `document.getElementById('ce-root')`

## Expected Behavior Summary

✅ **Working:**
- FAB appears on page load
- Text selection creates snippets
- Panel opens/closes smoothly
- Snippets persist across reloads
- Source navigation with highlight
- Copy to clipboard
- Remove/clear operations

❌ **Known Limitations (Stage 1):**
- No keyboard shortcuts
- No persistent highlights (only transient)
- No search/filter functionality
- No export options beyond copy

## Next Steps After Testing

If everything works:
- Add unit tests (see `plan/implementation-stage1.md`)
- Consider adding icons
- Prepare for Stage 2 features

If issues found:
- Check console errors
- Verify ChatGPT DOM structure hasn't changed
- Test on both chatgpt.com and chat.openai.com
