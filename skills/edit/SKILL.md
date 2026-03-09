---
name: edit
description: "Edit content in an existing vault note using read-overwrite. Triggers: \"change\", \"update the note\", \"fix the note\", \"modify\". For task completion use /complete-tasks. For appending use /capture or /log."
argument-hint: "<note name> <description of changes>"
---

# Edit Note

Modify existing content in a vault note using the read-overwrite pattern.

## Steps

1. **Parse arguments** — extract the note name and what changes to make

2. **Read the note** — call `vault_read` with the note name to get current content

3. **Apply changes** — modify the content as requested. Common operations:
   - Replace text
   - Remove sections
   - Reorder content
   - Update task states
   - Fix formatting
   - Add/remove tags in frontmatter

4. **Confirm with user** — for significant changes, briefly describe what will change before overwriting. Skip confirmation for simple/obvious edits.

5. **Rewrite the note** — call `vault_create` with `overwrite: true` and the modified content

6. **Confirm** — briefly state what was changed

## Important

- Always `vault_read` first — never guess at note contents
- Preserve frontmatter, formatting, and all unchanged content exactly
- For append-only changes, prefer `vault_append` instead (simpler, no overwrite risk)
- If the note is not found, tell the user and suggest `vault_search` to find it
