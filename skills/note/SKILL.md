---
name: note
description: Create a new structured note in the vault. Prompts for content if only a title is given.
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
4. Create the note using the `vault_create` MCP tool:
   - `name`: the title (the MCP server handles folder paths)
   - `content`: full note content with YAML frontmatter matching the note type format
5. Add a timestamped wikilink in today's daily note using `vault_daily_append`:
   - `content`: `\n- **HH:MM** — Created [[Title]] — brief context`
6. If the note references other people, projects, or topics with existing notes, add `[[wikilinks]]`

## Note Formats

**Person (`people/`):**
```
---
date: YYYY-MM-DD
tags:
  - type/person
---

## About

Role, relationship, key context.

## Notes

- **YYYY-MM-DD** — Initial context.
```

**Project (`projects/`):**
```
---
date: YYYY-MM-DD
tags:
  - type/project
  - topic/relevant-area
status: active
---

## Overview

What this project is and why it matters.

## Tasks

- [ ] Outstanding items

## Log

- **YYYY-MM-DD** — Created.
```

**Topic (`notes/`):**
```
---
date: YYYY-MM-DD
tags:
  - type/note
  - topic/relevant-area
---

Content here. Link to related [[notes]], [[people]], and [[projects]].
```

## Guidelines
- Add `[[wikilinks]]` to related existing notes where relevant
- If the user only gives a title, ask what they'd like in the note
- Keep it clean and scannable — use headings, bullets, and callouts
- Use namespaced tags only: `type/*`, `topic/*`, `status/*`
