---
date: 2026-03-28
device_type: entertainment
category: audio
brand: Sonos
household_id: Sonos_lOaVpzSItGxiKGgGqrtf3nt0hv.l7tgKzRV1yPIWf0SkEjM
tags:
  - type/device
  - device/entertainment
  - device/sonos
---

# Sonos Speaker System

Household: "Sonos S&S" (firmware 94.1-75110)
Connected via official Sonos Control API (cloud, OAuth 2.0).

## Players

| Speaker | Sonos Name | Player ID | Floor | Capabilities |
|---------|-----------|-----------|-------|-------------|
| Sonos (HT) | Rez de Chaussee | RINCON_F0F6C19DDD0C01400 | Ground | PLAYBACK, AIRPLAY, LINE_IN, AUDIO_CLIP, HDMI |
| Sonos (HT) | Sous-sol | RINCON_542A1BD1F32C01400 | Basement | PLAYBACK, AIRPLAY, AUDIO_CLIP, VOICE, IR_CONTROL, HDMI |

## Integration

- Official Sonos Control API at `api.ws.sonos.com/control/api/v1`
- OAuth tokens in `.sonos-tokens.json` (auto-refreshed)
- TTS via local Piper → MP3 → LAN HTTP server → Sonos audioClip API
- Supports French (fr_FR-siwis) and English (en_US-amy) voices
- Both speakers support AUDIO_CLIP for notifications/TTS overlay

## TTS Pipeline

1. Text → Piper TTS (local, offline) → WAV
2. WAV → ffmpeg → MP3
3. MP3 served at `http://192.168.2.153:3004/clips/{id}.mp3`
4. Sonos cloud API → speaker fetches MP3 from LAN → plays it
