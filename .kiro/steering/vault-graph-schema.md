# Vault Graph Schema

When creating or modifying files in the Obsidian vault (`vault/`), always follow this graph structure. Every note must be connected to the graph via `[[wikilinks]]`.

## Central Node

`vertex-nova` is the central agent node. All generated content links back to it.

## Graph Structure

```
serge ←→ vertex-nova ←→ home
  ↕            ↕            ↕
stephanie    dreams      devices (sonos, echo, smart-home)
              ↕            ↕
         daily-logs    topology (floors, rooms)
              ↕
        weekly-summaries
```

## Node Types and Linking Rules

| Node Type | Location | Must link to | Created by |
|-----------|----------|-------------|------------|
| Person | `vault/people/` | `vertex-nova`, `home`, other people | Manual or identity layer |
| Device | `vault/home/devices/` | `home`, relevant people, `vertex-nova` | Agent discovery |
| Room | `vault/home/topology/rooms/` | Parent floor note | Manual |
| Event | `vault/home/events/` | Relevant device, person, `home` | Agent (alerts) |
| Dream journal | `vault/dreams/YYYY-MM-DD.md` | `dreams-index` (via index), `vertex-nova` | Dream engine |
| Daily log | `vault/daily/YYYY-MM-DD.md` | `daily-logs` (via index), `vertex-nova` | Conversation manager |
| Weekly summary | `vault/weekly/` | `weekly-summaries` (via index), `vertex-nova` | Dream engine (phase 5) |
| Pattern | `vault/home/patterns/` | Related people, devices, `vertex-nova` | Thinker/Dream engine |
| Memory | `vault/memories/` | Related people or systems | Thinker/Identity layer |
| Complaint/Legal | `vault/home/complaints/` or `vault/legal/` | `home`, `serge` | Agent (email) |
| Movie | `vault/movies/` | `serge` (preferences) | Movie tool |
| Knowledge base (personal) | `vault/kb/<name>/` | `knowledge-bases`, `serge` or relevant person | KB sync |
| Knowledge base (home) | `vault/kb/<name>/` | `knowledge-bases`, `home` | KB sync |
| KB index note | `vault/kb/<name>/kb-<name>.md` | `knowledge-bases`, owner (person or home) | Manual |

## Rules for New Notes

1. **Always add at least one `[[wikilink]]`** to connect the note to the graph
2. **Link to the creator**: if Vertex Nova generated it, link to `[[vertex-nova]]`
3. **Link to the subject**: if it's about a person, link to `[[serge]]` or `[[stephanie]]`
4. **Link to the location**: if it's about the house, link to `[[home]]` or the specific room/device
5. **Use frontmatter tags** for filtering: `type/person`, `type/device`, `type/event`, `type/dream`, `created-by/vertex-nova`
6. **Super-nodes (MOCs)** group temporal content: `daily-logs`, `weekly-summaries`, `dreams-index` — update these indexes when adding new entries
7. **Never create orphan notes** — if you can't find a natural link, connect to `[[vertex-nova]]` as the fallback

## Frontmatter Template

```yaml
---
date: YYYY-MM-DD
tags:
  - type/<type>
  - created-by/vertex-nova
---
```

## Index Updates

When creating a new daily log, weekly summary, or dream journal entry, the corresponding index note (`daily-logs.md`, `weekly-summaries.md`, `dreams-index.md`) should be updated to include the new entry. This keeps the super-nodes current.

## Knowledge Base Grouping

KB content is grouped by category with an index note per KB:
- **Personal KBs** (about people): link to `[[serge]]` or the relevant person
  - `serge-poueme` → professional profile, CV
  - `emmanuel-poueme` → father, genealogy
- **Home KBs** (about the house): link to `[[home]]`
  - `home-maintenance-seasonal` → seasonal maintenance guides
  - `home-resources` → renovation, insurance, services
  - `home-safety-energy` → security, energy efficiency
  - `House-homevalue` → property value, market
  - `appliance-maintenance` → appliance guides

Each KB directory has an index note (`kb-<name>.md`) that connects it to `[[knowledge-bases]]` and the appropriate owner (person or home). Raw crawled pages don't need individual wikilinks — they're connected through their directory's index note.
