# Mode: Résidence

The default operating mode — a full-featured family assistant that monitors your home, manages communications, and learns over time.

## Dashboard

In residence mode, the admin dashboard (port 3080) shows:
- System status, uptime, memory
- Device status grid (smart home)
- Communication channels (Telegram, WhatsApp, Sonos, Email)
- Presence widget (who's home)
- Knowledge bases status
- Recent interactions (all channels)

Navigation includes: Accueil, Chat, Configuration, Connaissances, Appareils, Logs.

---

## Family Identity

Per-person agent conscience — adapts all interactions based on who's talking.

Configure in dashboard (Configuration → Famille) or `config/family.yaml`:
- Communication style (warm/concise/formal)
- Briefing depth (full/summary/minimal)
- Proactive notification level and rules per category
- Daily schedule (morning, work, evening, sleep hours)
- Interests (for recommendation filtering)
- Channel preferences

---

## Presence Detection

Tracks who's home by scanning the local network for known phone MAC addresses.

- **Per-person config** in `config/presence.yaml`: language, welcome style, welcome device, notifications
- ARP table polling every 30 seconds + ping sweep every ~2.5 minutes
- Smart thresholds: 15 min day, 60 min night (avoids false positives from phone sleep)
- Requires 2 consecutive missed polls before marking as "left"
- Night suppression: departures during night hours logged silently
- Travel detection: after 6 hours away → asks via Telegram
- Vacation mode: auto-enables when all residents away 24h+
- Arrival: notification + AI welcome greeting on configured device

All thresholds tunable from the dashboard (Configuration → Détection de présence).

```yaml
settings:
  poll_seconds: 30
  day_away_minutes: 15
  night_away_minutes: 60
  consecutive_misses: 2
  travel_ask_hours: 6
  vacation_hours: 24

people:
  - name: Alice
    mac: aa:bb:cc:dd:ee:ff
    language: fr
    welcome_style: briefing
    welcome_room: Living Room
    notifications: both
```

---

## Smart Home Monitoring

Devices discovered automatically via Alexa Smart Home API every 6 hours. State polling every 60 seconds with user-defined alert rules.

Each device rule includes an AI context field — specific instructions for what the agent should do when that device changes state:

| Device | Rule |
|--------|------|
| Security Panel | Night disarm = urgent alert. Repeated arm/disarm = suspicious. |
| Backyard Camera | Night motion = immediate alert. Weekday day = probably delivery. |
| Washer | Cycle done → remind to transfer. No dryer in 30 min → second reminder. |
| Oven | On > 2 hours → reminder. On after 11 PM → safety alert. |

---

## Email Agent

Monitors Gmail inbox, sends Telegram notifications for new emails, drafts AI replies, and composes new emails via natural language.

Workflow: New email → Telegram notification → "répondre abc123 dis que..." → AI draft → "envoyer abc123" → sent via SMTP.

---

## Knowledge Bases

Two types, configurable from the dashboard:

| Type | Source | How it works |
|------|--------|-------------|
| Git repo | GitHub/GitLab URL | Clones, extracts text, relationship-aware |
| URL collection | List of websites | Sitemap discovery, fetches up to 50 pages/site |

Semantic RAG pipeline: chunk → embed (nomic-embed-text) → store (Vectra) → retrieve (top-10) → rerank (Qwen3, top-5).

---

## Dream Engine v2

Nightly self-improvement system. Runs during quiet hours (1-5 AM) when idle.

| Phase | What it does |
|-------|-------------|
| 1-5 | Conversation review, memory consolidation, escalation analysis, tomorrow prep, weekly summary |
| Graph | Consolidates vault graph — connects orphan notes |
| 6 | Extracts Interaction Templates → ACU (Artificial Collective Unconscious) |
| 7 | Generates Dream Narratives (divergent → refined) + edge case scenarios |
| 8 | Interprets dreams → proposes policy updates |

Safety: all dream content tagged `[DREAM]`, blocked from live responses. Local model only. Ephemeral dreams auto-expire (14 days). Policy updates require manual approval.

Commands: `dream status`, `dream policies`, `dream now`, `approve policy <id>`, `reject policy <id>`

---

## Session Bootstrap

Cross-session memory persistence. On each new session, the agent loads:
- Last session summary
- Pending reminders and emails
- Recent dream learnings
- Identity facts (preferences, patterns)
- Current home state (presence, vacation mode)

---

## AI Tools (27)

| Category | Tools |
|----------|-------|
| Voice | `sonos_speak`, `sonos_chime`, `sonos_volume`, `sonos_rooms`, `echo_speak`, `echo_speak_all` |
| Search | `news_search`, `web_search`, `web_fetch`, `movie_recommend` |
| Vault | `vault_read`, `vault_search`, `vault_create`, `vault_append`, `vault_list` |
| Memory | `memory_view`, `memory_write`, `memory_append`, `reminder_set`, `reminder_list` |
| Knowledge | `kb_search`, `kb_list` |
| Email | `email_list`, `email_draft`, `email_send`, `email_compose` |
| Presence | `who_is_home` |

---

## Two-Stage Vision Pipeline

1. **Vision Agent** (Gemma 4 E2B) analyzes image → text description
2. **Text Agent** (Qwen3 8B) interprets and takes action if needed
3. Failed requests queued to disk, auto-retried every 15 minutes

---

## Proactive Actions

Scheduled tasks configured in `config/proactive.yaml`:
- Breaking news alerts
- Weather warnings
- Home maintenance reminders
- Email digests
- Friday movie recommendations
- Weekend activity suggestions

Multi-model: Phi-4 Mini for SKIP logic, Qwen3 for content generation.

---

## Do Not Disturb

Mutes all proactive notifications and voice output.

- Telegram: `mute` / `unmute`
- Dashboard: toggle in presence section
- API: `PUT /api/dnd {"enabled": true}`

Direct chat still works normally when muted.

---

## Model Routing

Pattern-based routing in `config/routing.yaml`:
- Vision requests → Gemma 4 / Qwen2.5-VL
- Complex/escalation → Claude
- Default → Qwen3 8B

Hot-swap models from the dashboard without restart.

---

## Offline Capability

Everything runs locally without cloud APIs:

| Feature | Local Stack |
|---------|------------|
| Text chat | Qwen3 8B (Ollama) |
| Voice input | whisper.cpp |
| Voice output | Piper TTS → Sonos |
| Image analysis | Gemma 4 E2B → Qwen3 |
| Search | DuckDuckGo / Google News RSS |

Claude is only used for escalation. On credit errors, enters 24h cooldown persisted to disk.
