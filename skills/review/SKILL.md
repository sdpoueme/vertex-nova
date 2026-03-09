---
name: review
description: "Review accomplishments and outstanding items for a time period. Triggers: \"how did my week go\", \"what did I get done\", \"review the month\". Read-only — does not create notes or archive. Use /weekly-review to create a summary note and archive."
argument-hint: "[day|week|month]"
---

# Period Review

Review what's been accomplished and what's outstanding over a time period.

## Steps

1. Determine the period from `$ARGUMENTS` (default to "day" if not specified)
2. Get today's date from the `[Current time: ...]` message header

3. **Calculate the date range:**
   - **Day**: today only
   - **Week**: Monday of the current week through today. Calculate Monday by subtracting (weekday - 1) days from today (Monday=1, Sunday=7).
   - **Month**: first of the current month (YYYY-MM-01) through today

4. **For daily review:**
   - Call `vault_read` with `path: "daily/YYYY-MM-DD.md"` to read today's note
   - Call `vault_tasks` with `status: "todo"`

5. **For weekly/monthly review:**
   - Call `vault_files` with `folder: "daily"` to list daily notes, then filter to those within the calculated date range
   - Call `vault_read` for each relevant daily note to gather accomplishments
   - Call `vault_tasks` with `status: "todo"` for all outstanding
   - Call `vault_tasks` with `status: "done"` for completed tasks

## Output Format

Present the review as:

**Accomplishments**
- Bullet list of what was completed/achieved, grouped by project or topic

**Outstanding**
- Remaining tasks and items, with note names in **bold**
- Count of outstanding items

**Summary**
- Brief narrative of the period — what went well, what's carrying over

Keep it factual — only report what's actually in the vault. Don't fabricate accomplishments.
