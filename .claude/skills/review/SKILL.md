---
name: review
description: Review accomplishments and outstanding items for a time period. Use /review day, /review week, or /review month.
argument-hint: "[day|week|month]"
---

# Period Review

Review what's been accomplished and what's outstanding over a time period.

## Steps

1. Determine the period from `$ARGUMENTS` (default to "day" if not specified)

2. **For daily review:**
   - Call `vault_daily_read` to read today's note
   - Call `vault_tasks` with `status: "todo"` and `daily: true`

3. **For weekly/monthly review**, search for relevant daily notes and activity:
   - Call `vault_search` with `query` set to the date range (e.g., "2026-03" for March)
   - Call `vault_tasks` with `status: "todo"` for all outstanding
   - Call `vault_tasks` with `status: "done"` for completed tasks
   - Call `vault_read` for each relevant daily note to gather accomplishments

4. **Search for completed tasks** across the vault:
   - Call `vault_tasks` with `status: "done"`

5. **Search for outstanding tasks:**
   - Call `vault_tasks` with `status: "todo"`

## Output Format

Present the review as:

### Accomplishments
- Bullet list of what was completed/achieved, grouped by project or topic

### Outstanding
- Remaining tasks and items, with note references as `[[Note Name]]`
- Count of outstanding items

### Summary
- Brief narrative of the period — what went well, what's carrying over

Keep it factual — only report what's actually in the vault. Don't fabricate accomplishments.
