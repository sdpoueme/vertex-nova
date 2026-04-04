# Vertex Nova

Personal home assistant that connects Telegram, Sonos speakers, Echo devices, and a markdown knowledge base into a single AI-powered system. Talk to your house via text, voice, or images — get intelligent responses and hear announcements throughout the house.

## How It Works

```
Telegram (text, voice, images)
              │
        Model Router ──── config/routing.yaml
      ┌───────┼───────┐
      │       │       │
  Claude   Gemma 4  Mistral
  (vision, (tools,  (casual
   complex  search,  chat)
   reason)  devices)
      │       │
      Tool calls
  ┌───┼───┬───┼───┐
  │   │   │   │   │
Sonos Echo Vault Web Email
(TTS) (VM) (md) (DDG) Monitor
```

## Three-Model Architecture

| Model | Where | Cost | Used For |
|-------|-------|------|----------|
| Claude (Sonnet) | Cloud API | Pay per use | Vision, complex reasoning, fallback |
| Gemma 4 (12B) | Local (Ollama) | Free | Device control, web search, vault, home tasks |
| Mistral (7B) | Local (Ollama) | Free | Casual chat, greetings, small talk |

Routing is configurable via `config/routing.yaml`. Images always go to Claude. Gemma 4 is the default for unmatched messages. If Claude API is down, Gemma 4 takes over automatically.

## Features

- Telegram — text, voice messages (whisper.cpp), image analysis (Claude vision)
- WhatsApp — text and voice (configurable, disabled by default)
- Sonos TTS — official Sonos Cloud API + local Piper TTS (offline, FR + EN)
- Echo devices — announcements via Voice Monkey API (speak, speak-all)
- Web search — DuckDuckGo search + page fetch for current information
- Email monitor — polls Gmail for device alerts (Telus, MyQ, Honeywell), AI analyzes for anomalies
- Proactive scheduler — breaking news, weather alerts, home maintenance, Friday movies, weekend activities
- Smart notification routing by time of day (Echo Show mornings, office Echo workday, Sonos evenings, Telegram nights)
- Reminders — natural language ("rappelle-moi demain à 10h"), auto-delivers via best channel at the right time
- Knowledge base — markdown vault for home topology, devices, events, tasks (excluded from git)
- User identity — knows who's talking, auto-detects language (FR/EN)
- Night mode — Sonos guardrail redirects ground floor to basement 10 PM–7 AM
- Session memory — conversations persist throughout the day
- Auto-start — runs as macOS Launch Agent on login

## Architecture

```
src/
├── home-agent.js          # Main entry point
├── ai.js                  # Claude + Gemma 4 + Mistral, tool execution
├── model-router.js        # YAML-based model routing
├── proactive.js           # Proactive scheduler (news, weather, maintenance)
├── reminders.js           # Reminder engine with smart delivery
├── email-monitor.js       # Gmail polling for device alerts
├── home-config.js         # Configuration from .env
├── tts-server.js          # Local HTTP server for Sonos TTS
├── channels/
│   ├── telegram.js        # Telegram (text, voice, images)
│   └── whatsapp.js        # WhatsApp Business API
├── outputs/
│   ├── voicemonkey.js     # Echo device TTS via Voice Monkey
│   ├── sonos.js           # Sonos Cloud API client
│   └── router.js          # Output routing
└── log.js                 # Leveled logger

config/
├── routing.yaml           # AI model routing rules
└── proactive.yaml         # Proactive actions and notification routing

scripts/
├── sonos-auth.js          # Sonos OAuth flow
├── sonos-cli.js           # Sonos CLI for AI tool calls
└── com.vertexnova.agent.plist  # macOS Launch Agent
```

## Setup

### Prerequisites

- Node.js 20+
- ffmpeg (`brew install ffmpeg`)
- Piper TTS (`pipx install piper-tts && pipx inject piper-tts pathvalidate`)
- whisper.cpp (`brew install whisper-cpp`)
- Ollama (`brew install ollama && brew services start ollama`)
  - `ollama pull gemma4` (primary local model, 9.6GB)
  - `ollama pull mistral` (fast chat model, 4.4GB)

### Install

```bash
git clone <repo> vertex-nova && cd vertex-nova
npm install
node scripts/sonos-auth.js    # Sonos OAuth
cp .env.home.example .env     # Configure credentials
npm start
```

### Auto-start on macOS

```bash
cp scripts/com.vertexnova.agent.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.vertexnova.agent.plist
```

## AI Tools

| Tool | Description |
|------|-------------|
| sonos_speak | TTS on Sonos speaker |
| sonos_speak_all | TTS on all Sonos speakers |
| sonos_chime | Notification chime |
| sonos_volume | Set volume |
| echo_speak | TTS on Echo device (Voice Monkey) |
| echo_speak_all | TTS on all Echo devices |
| web_search | Search the internet (DuckDuckGo) |
| web_fetch | Fetch and read a web page |
| vault_read | Read vault note |
| vault_search | Search vault |
| vault_create | Create note |
| vault_append | Append to note |
| vault_list | List folder |
| reminder_set | Set a reminder (date, time, text) |
| reminder_list | List pending reminders |

## Proactive Actions (config/proactive.yaml)

| Action | Interval | Priority |
|--------|----------|----------|
| Breaking news | 30 min | High |
| Weather alerts | 60 min | High |
| Home maintenance | 6 hours | Medium |
| Friday movies | Fridays 5-7 PM | Medium |
| Weekend activities | Saturdays 8-9 AM | Medium |
| Email digest | 2 hours | Low |

Notifications route to the right device based on time of day. AI decides whether to notify based on relevance — routine stuff gets skipped.

## Notification Routing

| Time | Channel | Device |
|------|---------|--------|
| 10 PM – 7 AM | Telegram | Silent (night mode) |
| 7 – 9 AM | Echo | Echo Show (kitchen) |
| 9 AM – 5 PM | Echo | Bureau Serge (office) |
| 5 – 7 PM | Echo | Echo Show (kitchen) |
| 7 – 9 PM | Sonos | Sous-sol (basement) |
| 9 – 10 PM | Telegram | Silent |

Applies to reminders, proactive actions, and email alerts. Night guardrail enforced at all levels — voice devices never speak between 10 PM and 7 AM.

## Roadmap

- Alexa+ Multi-Agent SDK — voice input from Echo devices (pending SDK access)
- Honeywell thermostat API — direct temperature monitoring and control
- Docker — containerized deployment
