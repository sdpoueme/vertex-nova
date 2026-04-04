# Vertex Nova

Personal home assistant — Telegram, Sonos, Echo devices, AI with persistent memory.

## Architecture

```
Message → Gemma 4 (default, free, local)
              │
         Good response? ── Yes → return
              │ No
         Escalate to Claude → return + save pattern
              │
         Both fail → friendly error
```

| Model | Role | Cost |
|-------|------|------|
| Gemma 4 (12B) | Default for everything — tools, search, chat, vision | Free (local) |
| Claude Sonnet | Escalation — complex reasoning, Gemma 4 failures | Pay per use |

Gemma 4 handles 80%+ of requests including vision. Claude activates only when Gemma 4 gives a bad response. System runs fully offline at zero cost when Claude API is unavailable.

## Features

- **Telegram** — text, voice (whisper.cpp), images (Gemma 4 vision, Claude fallback)
- **WhatsApp** — text and voice (configurable)
- **Sonos TTS** — official Cloud API + local Piper (offline, FR/EN)
- **Echo devices** — Voice Monkey API (speak, speak-all)
- **Web search** — DuckDuckGo + page fetch
- **Persistent memory** — cross-session learning in vault/memories/
- **Reminders** — natural language, smart delivery by time of day
- **Proactive scheduler** — news, weather, maintenance, movies, activities
- **Email monitor** — Gmail polling for device alerts (Telus, MyQ, Honeywell)
- **Conversation memory** — sliding window + auto-summarization
- **Night mode** — voice devices blocked 10 PM–7 AM
- **Auto-start** — macOS Launch Agent
- **Fully offline capable** — all features work on Gemma 4 alone (voice, vision, tools)

## AI Tools

| Tool | Description |
|------|-------------|
| sonos_speak | TTS on Sonos speaker |
| sonos_speak_all | TTS on all Sonos |
| sonos_chime | Notification chime |
| sonos_volume | Set volume |
| echo_speak | TTS on Echo (Voice Monkey) |
| echo_speak_all | TTS on all Echo devices |
| web_search | DuckDuckGo search |
| web_fetch | Fetch web page content |
| vault_read | Read vault note |
| vault_search | Search vault |
| vault_create | Create note |
| vault_append | Append to note |
| vault_list | List folder |
| reminder_set | Set a reminder |
| reminder_list | List pending reminders |
| memory_view | View learned patterns |
| memory_write | Save new learning |
| memory_append | Add to existing memory |

## Notification Routing

| Time | Channel | Device |
|------|---------|--------|
| 10 PM – 7 AM | Telegram | Silent |
| 7 – 9 AM | Echo | Echo Show (kitchen) |
| 9 AM – 5 PM | Echo | Bureau Serge (office) |
| 5 – 7 PM | Echo | Echo Show (kitchen) |
| 7 – 9 PM | Sonos | Sous-sol (basement) |
| 9 – 10 PM | Telegram | Silent |

## Setup

```bash
# Prerequisites: Node 20+, ffmpeg, Piper TTS, whisper-cpp, Ollama
brew install ffmpeg whisper-cpp ollama
pipx install piper-tts && pipx inject piper-tts pathvalidate
ollama pull gemma4

# Install
git clone <repo> vertex-nova && cd vertex-nova
npm install
node scripts/sonos-auth.js
cp .env.home.example .env  # Edit with credentials
npm start

# Auto-start on macOS
cp scripts/com.vertexnova.agent.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.vertexnova.agent.plist
```

## Proactive Actions

| Action | Interval | Model |
|--------|----------|-------|
| Breaking news | 30 min | Gemma 4 |
| Weather alerts | 60 min | Gemma 4 |
| Home maintenance | 6 hours | Gemma 4 |
| Friday movies | Fridays 5-7 PM | Gemma 4 |
| Weekend activities | Saturdays 8-9 AM | Gemma 4 |
| Email digest | 2 hours | Gemma 4 |

## Offline Capability

Everything runs locally without Claude API:

| Feature | Local Stack |
|---------|------------|
| Text chat | Gemma 4 (Ollama) |
| Voice input | whisper.cpp |
| Voice output (Sonos) | Piper TTS + Sonos Cloud API |
| Voice output (Echo) | Voice Monkey API |
| Image analysis | Gemma 4 vision (Ollama) |
| Web search | DuckDuckGo |
| Tools | All 18 tools work on Gemma 4 |

## Roadmap

- Alexa+ Multi-Agent SDK — voice input from Echo devices
- Honeywell thermostat API — direct temperature control
- Docker deployment
