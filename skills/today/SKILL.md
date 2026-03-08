---
name: today
description: Show what's on my plate today — daily note contents, outstanding tasks, and context from recent notes.
argument-hint: ""
---

# Today Overview

Give the user a clear picture of their day by calling these MCP tools and synthesizing the results:

## Steps

1. **Read today's daily note** — get today's date from the `[Current time: ...]` header, then call `vault_read` with `path: "daily/YYYY-MM-DD.md"`

2. **Get outstanding tasks across the vault** — call `vault_tasks` with `status: "todo"`

3. **Check recent files for context** — call `vault_files`

## Output Format

Present a concise summary:
- **Today's Notes**: Key points from the daily note (skip raw/unprocessed voice dumps)
- **Tasks**: Outstanding items, grouped by note/project if possible
- **Context**: Any relevant recent activity or upcoming items mentioned in notes

Keep it conversational and brief. If the daily note doesn't exist yet, say so and offer to create it.
