---
name: today
description: "Show what's on my plate today. Triggers: \"what's up\", \"morning briefing\", \"what do I have going on\", \"what's on my plate\", \"anything today\". Read-only overview — does not create or modify notes."
argument-hint: ""
---

# Today Overview

Give the user a clear picture of their day by calling these MCP tools and synthesizing the results:

## Steps

1. **Read today's daily note** — get today's date from the `[Current time: ...]` header, then call `vault_read` with `path: "daily/YYYY-MM-DD.md"`

2. **Get outstanding tasks across the vault** — call `vault_tasks` with `status: "todo"`

3. **Check recent files for context** — call `vault_files` and filter to notes modified recently

## Output Format

Present a concise summary:
- **Today's Notes**: Key points from the daily note (skip raw/unprocessed voice dumps)
- **Tasks**: Outstanding items, grouped by note/project if possible
- **Context**: Any relevant recent activity or upcoming items mentioned in notes

## Edge Cases
- If the daily note doesn't exist yet, say so — then fall back to outstanding tasks and recent activity as the overview
- On quiet days with few or no tasks, keep the response short rather than padding with filler
- When `vault_files` returns many results, focus on files in `daily/`, `projects/`, and `notes/` — skip `archive/` folders

Keep it conversational and brief.
