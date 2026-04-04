# Vertex Nova

Personal home assistant — Telegram, Sonos, Echo devices, AI with persistent memory.

## Architecture

```
Message → Qwen3 8B (default, free, local)
              │
         Good response? ── Yes → return
              │ No
         Escalate to Claude → return + save pattern
              │
         Both fail → friendly error
```

| Model | Role | Cost |
|-------|------|------|
| Qwen3 (8B) | Default for everything — tools, search, chat | Free (local) |
| Claude Sonnet | Escalation — complex reasoning, Qwen3 failures | Pay per use |

Qwen3 handles 80%+ of requests. Images fall back to Gemma 4 E2B (vision) or Claude. Claude activates only when Qwen3 gives a bad response. System runs fully offline at zero cost when Claude API is unavailable.

## Features

- **Telegram** — text, voice (whisper.cpp), images (Gemma 4 E2B vision, Claude fallback)
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
- **Fully offline capable** — all features work locally (Qwen3 + Gemma 4 E2B for vision)

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
ollama pull qwen3:8b

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
| Breaking news | 30 min | Qwen3 |
| Weather alerts | 60 min | Qwen3 |
| Home maintenance | 6 hours | Qwen3 |
| Friday movies | Fridays 5-7 PM | Qwen3 |
| Weekend activities | Saturdays 8-9 AM | Qwen3 |
| Email digest | 2 hours | Qwen3 |

## Offline Capability

Everything runs locally without Claude API:

| Feature | Local Stack |
|---------|------------|
| Text chat | Qwen3 8B (Ollama) |
| Voice input | whisper.cpp |
| Voice output (Sonos) | Piper TTS + Sonos Cloud API |
| Voice output (Echo) | Voice Monkey API |
| Image analysis | Gemma 4 E2B vision (Ollama) |
| Web search | DuckDuckGo |
| Tools | All 18 tools work on Qwen3 |

## Choosing a Local Model

The default local model is configurable via `OLLAMA_MODEL` in `.env`. The choice depends on your hardware:

| Model | RAM Needed | Speed | Quality | Best For |
|-------|-----------|-------|---------|----------|
| `qwen3:8b` | 8GB+ | ⚡ Fast (~15s) | Good | **Recommended for 24GB Macs** — best speed/quality balance, excellent French, strong tool use |
| `gemma4` (12B) | 16GB+ | 🐢 Slow (~30-150s) | Very good | 32GB+ Macs — better reasoning but much slower on 24GB |
| `gemma4:e4b` | 12GB+ | 🐢 Medium (~20s) | Good | Multimodal (vision) — use for image analysis fallback |
| `mistral` (7B) | 8GB+ | ⚡ Fast (~10s) | Decent | Lightweight chat, less accurate for French |
| `qwen3:4b` | 6GB+ | ⚡⚡ Very fast (~8s) | OK | Low-RAM machines, speed priority over quality |
| `qwen3:14b` | 16GB+ | 🐢 Medium (~25s) | Very good | 32GB+ Macs — stronger reasoning than 8B |

To switch models:

```bash
# 1. Pull the model
ollama pull qwen3:8b

# 2. Update .env
OLLAMA_MODEL=qwen3:8b

# 3. Restart
launchctl unload ~/Library/LaunchAgents/com.vertexnova.agent.plist
launchctl load ~/Library/LaunchAgents/com.vertexnova.agent.plist
```

Key tradeoffs:
- **RAM vs speed**: Larger models need more RAM. If the model exceeds available RAM, it swaps to disk and becomes 10x slower.
- **Quality vs latency**: 14B models reason better but take longer. For a home assistant, 8B with fast responses is usually better than 14B with 30s delays.
- **Vision**: Qwen3 is text-only. Images use Gemma 4 E2B or Claude for vision.

## Roadmap

- Alexa+ Multi-Agent SDK — voice input from Echo devices
- Honeywell thermostat API — direct temperature control
- Docker deployment
