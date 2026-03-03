---
name: find
description: Deep search across the vault for information. Searches content, tags, properties, and follows links to synthesize results.
argument-hint: "<search query>"
---

# Vault Search

Search the vault deeply for information matching `$ARGUMENTS`.

## Steps

1. **Text search** — call `vault_search` with `query: "$ARGUMENTS"` and optionally `context: true` for matching lines

2. **Tag search** (if the query relates to a topic) — call `vault_tags` to list all tags, then `vault_tags` with `name` for a specific tag

3. **Read matching notes** — call `vault_read` with `file` for each relevant match

4. **Follow links** from matching notes to find related context:
   - Call `vault_links` with `file` to get outgoing links
   - Call `vault_backlinks` with `file` to get incoming links

5. **Synthesize** — present the findings clearly, citing which notes contain what.

## Output Format
- Quote relevant passages from notes
- Cite note names as `[[Note Name]]` so the user can navigate to them in Obsidian
- If nothing found, say so and suggest alternative search terms
