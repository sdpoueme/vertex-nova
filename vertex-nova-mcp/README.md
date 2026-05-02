# Vertex Nova MCP Server

Privacy-aware MCP server that exposes Vertex Nova's smart home capabilities to external agents (e.g., Amazon Quick).

## Privacy Wall

This server enforces a **hard privacy boundary**:

- ❌ **Never sends**: dollar amounts, account numbers, financial data, family data, personal relationship data
- ✅ **Only sends**: directional operational signals (e.g., "gas consumption elevated"), device queries, seasonal checks
- 🤖 **Always identifies**: every message is prefixed with `[AUTOMATED AGENT: <name>]` so Vertex Nova distinguishes agent traffic from human users (Serge & Stéphanie)

Financial data patterns are automatically detected and rejected at the tool level.

## Tools

| Tool | Description |
|------|-------------|
| `vertex_health` | Check if Vertex Nova is online |
| `vertex_chat` | General-purpose chat (privacy-filtered) |
| `vertex_investigate_energy` | Investigate energy consumption anomalies |
| `vertex_investigate_security` | Investigate security system patterns |
| `vertex_seasonal_check` | Seasonal readiness check & optimization |
| `vertex_device_status` | Smart home device status report |
| `vertex_presence_report` | Presence detection patterns |

## Setup

```bash
cd vertex-nova-mcp
npm install
npm run build
```

## Usage with Amazon Quick

Add to your MCP server configuration:

```json
{
  "vertex-nova": {
    "command": "node",
    "args": ["/Users/pouemes/Projects/synapse/vertex-nova-mcp/build/index.js"],
    "env": {
      "VERTEX_NOVA_URL": "https://192.168.2.153:3080"
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VERTEX_NOVA_URL` | `https://192.168.2.153:3080` | Vertex Nova web dashboard URL |
