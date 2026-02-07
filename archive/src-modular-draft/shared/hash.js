/**
 * Simple hash function for text content.
 * Returns a stable hash for identical normalized input.
 */
export function hashText(text) {
  if (!text) return '';
  
  // Normalize whitespace: trim and collapse multiple spaces/newlines
  const normalized = text.trim().replace(/\s+/g, ' ');
  
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(36);
}
