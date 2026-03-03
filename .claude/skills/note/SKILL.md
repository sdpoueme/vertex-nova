---
name: note
description: Create a new structured note in the vault. Prompts for content if only a title is given.
argument-hint: "<title> [content or topic]"
---

# Create Note

Create a well-structured note in the vault.

## Steps

1. Parse `$ARGUMENTS` — first argument is the title, rest is optional content/context
2. Determine appropriate tags based on context (e.g., `#work`, `#project`, `#personal`, `#meeting`)
3. Create the note using the `vault_create` MCP tool:
   - `name`: the title
   - `content`: full note content with YAML frontmatter, e.g.:
     ```
     ---\ntags:\n  - tag1\n  - tag2\ndate: YYYY-MM-DD\n---\n\n# Title\n\nContent here...
     ```
4. Add a wikilink reference in today's daily note using `vault_daily_append`:
   - `content`: `\n- Created [[Title]]`

## Vault Conventions
- Always include YAML frontmatter with at least `tags` and `date`
- Use `[[wikilinks]]` to connect related notes
- Use Obsidian-flavored markdown: callouts (`> [!type]`), wikilinks, tasks (`- [ ]`)
- Daily notes use format `YYYY-MM-DD.md`

## Guidelines
- Add `[[wikilinks]]` to related existing notes where relevant
- If the user only gives a title, ask what they'd like in the note
- Keep it clean and scannable — use headings, bullets, and callouts
