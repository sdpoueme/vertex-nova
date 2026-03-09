---
name: note
description: "Create a new structured note in people/, projects/, or notes/. Triggers: \"create a note\", \"new note\", \"start a note about\", \"add a person\", \"new project\". For quick daily captures, use /capture instead."
argument-hint: "<title> [content or topic]"
---

# Create Note

Create a well-structured note in the vault, placed in the appropriate folder.

## Steps

1. Parse `$ARGUMENTS` — first argument is the title, rest is optional content/context
2. Determine the note type and folder:
   - If it's about a person → `people/` with `type/person` tag
   - If it's a project or workstream → `projects/` with `type/project` tag and `status: active`
   - Otherwise → `notes/` with `type/note` tag
3. Determine appropriate `topic/*` tags based on content
4. Create the note using `vault_create`:
   - `name`: `folder/title` (e.g., `notes/Meeting Notes`, `people/Sam`, `projects/Website Redesign`)
   - `content`: full note content with YAML frontmatter — use the note type formats defined in CLAUDE.md for person, project, and topic notes
5. Add a timestamped wikilink in today's daily note using `vault_append` with `file: "daily/YYYY-MM-DD"`:
   - `content`: `\n- **HH:MM** — Created [[Title]] — brief context`
   - If the daily note doesn't exist yet, create it first with `vault_create`
6. If the note references other people, projects, or topics with existing notes, add `[[wikilinks]]`

## Guidelines
- Add `[[wikilinks]]` to related existing notes where relevant
- If the user only gives a title, ask what they'd like in the note
- Keep it clean and scannable — use headings, bullets, and callouts
- Use namespaced tags only: `type/*`, `topic/*`, `status/*`
