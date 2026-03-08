---
name: review
description: Review accomplishments and outstanding items for a time period. Use /review day, /review week, or /review month.
argument-hint: "[day|week|month]"
---

# Period Review

Review what's been accomplished and what's outstanding over a time period.

## Steps

1. Determine the period from `$ARGUMENTS` (default to "day" if not specified)
2. Get today's date from the `[Current time: ...]` message header

3. **For daily review:**
   - Call `vault_read` with `path: "daily/YYYY-MM-DD.md"` to read today's note
   - Call `vault_tasks` with `status: "todo"`

4. **For weekly/monthly review**, search for relevant daily notes and activity:
   - Call `vault_files` with `folder: "daily"` to find daily notes in the date range
   - Call `vault_read` for each relevant daily note to gather accomplishments
   - Call `vault_tasks` with `status: "todo"` for all outstanding
   - Call `vault_tasks` with `status: "done"` for completed tasks

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
