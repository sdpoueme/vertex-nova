# Vertex Nova

A personal home assistant that connects Telegram, WhatsApp, Sonos speakers, and a markdown vault into a single AI-powered system. Talk to your house via text, voice, or images — get intelligent responses and hear announcements on your Sonos speakers.

## How It Works

```
Telegram / WhatsApp (text, voice, images)
              │
              ▼
        Model Router ──── config/routing.yaml
         ┌────┴────┐
         │         │
    Claude API   Ollama (local)
    (reasoning,  (casual chat,
     tools,       data analysis)
     vision)
         │
    Tool calls
    ┌────┴────┐
    │         │
 Sonos CLI   Vault
 (speakers)  (knowledge base)
```

Messages arrive via Telegram or WhatsApp. Voice messages are transcribed locally with whisper.cpp. Images are analyzed by Claude's vision. The model router decides whether to use Claude (deep reasoning, tool use, vision) or Ollama/Mistral (casual chat, simple queries) based on configurable YAML rules. Responses go back to the originating channel, and Sonos speakers can announce throughout the house.

## Features

- **Telegram** — text, voice messages, and image analysis
- **WhatsApp** — text and voice messages (configurable)
- **Sonos TTS** — speak on any speaker via official Sonos Cloud API + local Piper TTS
- **Voice transcription** — whisper.cpp, auto-detects French/English
- **Image analysis** — Claude vision for photos sent via Telegram
- **Smart model routing** — Claude for reasoning/tools, Ollama for casual/data tasks
- **Ollama fallback** — automatic switch to local model if Claude API is unavailable
- **Knowledge base** — markdown vault for home topology, devices, events, tasks
- **User identity** — knows who's talking, remembers language preference
- **Night mode** — Sonos guardrail redirects ground floor to basement after 10 PM
- **Session memory** — conversations persist throughout the day
- **Bilingual** — French and English, auto-detects from user input

## Architecture

```
src/
├── home-agent.js          # Main entry point
├── ai.js                  # Claude API + Ollama + tool execution
├── model-router.js        # YAML-based model routing
├── home-config.js         # Configuration from .env
├── tts-server.js          # Local HTTP server for Sonos TTS audio
├── channels/
│   ├── telegram.js        # Telegram bot (text, voice, images)
│   └── whatsapp.js        # WhatsApp Business Cloud API
├── outputs/
│   ├── router.js          # Output routing
│   ├── sonos.js           # Sonos Cloud API client
│   └── alexa-devices.js   # Alexa device output (future)
└── log.js                 # Leveled logger

config/
└── routing.yaml           # AI model routing rules

scripts/
├── sonos-auth.js          # Sonos OAuth flow
├── sonos-cli.js           # Sonos CLI (used by AI tool calls)
└── test-whatsapp.js       # WhatsApp webhook test

skills/                    # AI skill definitions
├── home-event/            # Log home events
├── home-status/           # Home overview
├── home-recommend/        # Proactive recommendations
└── home-device/           # Device inventory

vault/                     # Knowledge base
├── home/
│   ├── topology/          # Rooms, floors, layout
│   ├── devices/           # Device inventory
│   ├── events/            # Home event log
│   ├── tasks/             # Scheduled tasks
│   └── recommendations/   # AI-generated insights
├── daily/                 # Daily notes
├── people/                # User profiles + contacts
└── notes/                 # General notes

alexa-skill/               # Alexa integration (pending Alexa+ SDK)
```

## Setup

### Prerequisites

- Node.js 20+
- ffmpeg (`brew install ffmpeg`)
- Piper TTS (`pipx install piper-tts && pipx inject piper-tts pathvalidate`)
- whisper.cpp (`brew install whisper-cpp`)
- Ollama (`brew install ollama && brew services start ollama && ollama pull mistral`)

### 1. Install

```bash
git clone <repo-url> vertex-nova && cd vertex-nova
git submodule update --init --recursive
cd obsidian-mcp && npm install && npm run build && cd ..
npm install
```

### 2. Sonos Authorization

```bash
node scripts/sonos-auth.js
```

### 3. Configure

```bash
cp .env.home.example .env
# Edit .env with your credentials
```

### 4. Run

```bash
npm start
```

## Channel Configuration

Enable channels in `.env`:

```bash
# Telegram (default)
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your-token-from-botfather
TELEGRAM_ALLOWED_USER_IDS=your-numeric-id

# WhatsApp (optional, requires Meta Business + tunnel)
WHATSAPP_ENABLED=false
WHATSAPP_TOKEN=your-meta-token
WHATSAPP_PHONE_ID=your-phone-id
WHATSAPP_VERIFY_TOKEN=vertex-nova-whatsapp
```

## Model Routing

Edit `config/routing.yaml` to control which AI model handles which messages:

```yaml
routes:
  - name: sonos-control
    patterns: ["sonos", "speaker", "annonce"]
    model: claude          # needs tool use

  - name: casual-chat
    patterns: ["bonjour", "merci", "salut"]
    model: ollama          # fast, free, local

default:
  model: claude            # unmatched → Claude
```

Images always go to Claude (vision). Ollama is automatic fallback if Claude API is down.

## AI Tools

| Tool | Description |
|------|-------------|
| `sonos_speak` | TTS on a specific Sonos speaker |
| `sonos_speak_all` | TTS on all speakers |
| `sonos_chime` | Play notification chime |
| `sonos_volume` | Set speaker volume |
| `sonos_rooms` | List available speakers |
| `vault_read` | Read a note from the vault |
| `vault_search` | Search across all notes |
| `vault_create` | Create a new note |
| `vault_append` | Append to an existing note |
| `vault_list` | List files in a folder |

## Night Mode

10 PM – 7 AM: Sonos commands targeting "Rez de Chaussee" are automatically redirected to "Sous-sol". Enforced at three levels: AI prompt, tool execution, and CLI guardrail.

## Future

- **Alexa+** — Multi-Agent SDK integration (pending early access)
- **Home Assistant** — device event capture when Alexa Media Player stabilizes
- **Docker** — containerized deployment
- **More Sonos speakers** — as you add them, they're auto-discovered
