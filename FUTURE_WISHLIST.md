# Future Wishlist

## Optional host permissions for other LLMs
- Keep current `content_scripts.matches` limited to ChatGPT domains.
- Add optional host permissions for additional domains (curated list + custom domain).
- Provide an in-panel UI to request/revoke per-site access.
- Validate custom domains and convert to match patterns (e.g., `https://example.com/*`).
- Use `chrome.permissions.request({ origins: [...] })` to grant access on demand.
- Explain why access is needed in the prompt and store listing.
