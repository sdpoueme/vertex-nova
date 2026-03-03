/**
 * Convert Obsidian-flavored markdown to Telegram-compatible markdown.
 * Uses legacy Markdown parse mode (not MarkdownV2) to avoid escaping hell.
 */
export function formatForTelegram(text) {
  if (!text) return '';

  let result = text;

  // Convert wikilinks: [[Note Name]] → *Note Name*, [[Note|Alias]] → *Alias*
  result = result.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '*$2*');
  result = result.replace(/\[\[([^\]]+)\]\]/g, '*$1*');

  // Convert headers to bold
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Strip Obsidian callout markers but keep content
  result = result.replace(/^>\s*\[!(\w+)\]\s*(.*)$/gm, '*$1:* $2');

  // Strip highlight markers ==text== → text
  result = result.replace(/==([^=]+)==/g, '$1');

  return result.trim();
}

/**
 * Split a long message into chunks that fit within Telegram's limit.
 * Splits at paragraph boundaries, then line boundaries, then word boundaries.
 */
export function splitMessage(text, maxLength = 3800) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = -1;

    // Try to split at paragraph boundary (double newline)
    const paraIdx = remaining.lastIndexOf('\n\n', maxLength);
    if (paraIdx > maxLength * 0.3) {
      splitAt = paraIdx;
    }

    // Fall back to line boundary
    if (splitAt === -1) {
      const lineIdx = remaining.lastIndexOf('\n', maxLength);
      if (lineIdx > maxLength * 0.3) {
        splitAt = lineIdx;
      }
    }

    // Fall back to space
    if (splitAt === -1) {
      const spaceIdx = remaining.lastIndexOf(' ', maxLength);
      if (spaceIdx > maxLength * 0.3) {
        splitAt = spaceIdx;
      }
    }

    // Last resort: hard cut
    if (splitAt === -1) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (chunks.length > 1) {
    return chunks.map((chunk, i) => `(${i + 1}/${chunks.length})\n${chunk}`);
  }

  return chunks;
}
