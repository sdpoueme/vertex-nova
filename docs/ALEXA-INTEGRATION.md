# Alexa Smart Home Integration — Design Spec

## Overview

Use Alexa's internal API to discover and monitor smart home devices as a 4th notification source. This replaces the need to scan macOS logs for device notifications.

## How It Works

Alexa's internal API (used by the Alexa mobile app) exposes:
- Device discovery: list all smart home devices (lights, thermostats, locks, sensors)
- Device state: query current state (on/off, temperature, lock status)
- Device history: detect state changes

## Authentication

Uses cookie-based auth from the Alexa web app:
- `UBID_MAIN` — Amazon session cookie
- `AT_MAIN` — Amazon auth token

These can be extracted from the Alexa web app (alexa.amazon.com) browser cookies.

## New .env Variables

```env
ALEXA_UBID_MAIN=your-ubid-main-cookie
ALEXA_AT_MAIN=your-at-main-cookie
```

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `alexa.amazon.com/api/devices-v2/device` | List all Alexa devices |
| `alexa.amazon.com/api/smarthome/v2/endpoints` | List smart home endpoints |
| `alexa.amazon.com/api/phoenix/state` | Query device states |
| `alexa.amazon.com/nexus/v1/graphql` | GraphQL for detailed device info |

## Integration Points

1. **New notification source type: `alexa_api`** in `config/devices.yaml`
2. **Periodic state polling** — check device states every 30-60 seconds
3. **State change detection** — compare current vs previous state to detect events
4. **Anomaly detection** — same pattern engine as macOS logs

## Device Mapping

| Alexa Category | Maps To |
|---------------|---------|
| `LIGHT` | Light on/off events |
| `THERMOSTAT` | Temperature changes |
| `SMARTLOCK` | Lock/unlock events |
| `GARAGE_DOOR` | Open/close events |
| `CAMERA` | Motion detection |
| `ALEXA_VOICE_ENABLED` | Echo device status |

## Implementation Plan

1. Create `src/alexa-api.js` — port the TypeScript utils to JS
2. Add `alexa_api` source type to notification monitor
3. Add state polling with change detection
4. Add Alexa cookie config to dashboard
5. Update device config YAML to support `type: alexa_api`

## Reference

Based on: https://github.com/sijan2/alexa-mcp-server
