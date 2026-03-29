# Alexa Skill — Home Assistant

Custom Alexa skill that connects your Echo devices to the home assistant.

## Setup

### 1. Create the Skill

1. Go to [developer.amazon.com/alexa/console](https://developer.amazon.com/alexa/console/ask)
2. Click "Create Skill"
3. Name: "Home Assistant" (or "Assistant Maison" for French)
4. Primary locale: English (US) — add French (Canada) as additional locale
5. Type: Custom
6. Hosting: Provision your own (we'll use Lambda)
7. Template: Start from scratch

### 2. Import the Interaction Model

1. In the skill console, go to "JSON Editor" under Interaction Model
2. Paste the contents of `interactionModels/custom/en-US.json`
3. Click "Save Model" then "Build Model"
4. Switch to fr-CA locale and import `interactionModels/custom/fr-CA.json`

### 3. Deploy the Lambda

1. Create a new Lambda function in AWS Console (Node.js 20.x runtime)
2. Upload `lambda/index.mjs` as the handler
3. Set environment variable: `HOME_ASSISTANT_URL=https://your-domain:3002/alexa`
4. Set timeout to 30 seconds
5. Add Alexa Skills Kit trigger with your Skill ID

### 4. Connect Skill to Lambda

1. In the Alexa skill console, go to Endpoint
2. Select AWS Lambda ARN
3. Paste your Lambda function ARN
4. Save and build

### 5. Test

1. Go to the Test tab in the Alexa console
2. Enable testing in "Development" mode
3. Try: "Alexa, open home assistant"
4. Try: "what's the home status"
5. Try: "report a power outage"

### Intents

| Intent | What it does | Example |
|--------|-------------|---------|
| HomeAssistantIntent | General catch-all query | "ask home assistant about the furnace filter" |
| HomeStatusIntent | Quick home overview | "what's the status" |
| HomeEventIntent | Log a home event | "report a power outage" |
| HomeRecommendIntent | Get recommendations | "any maintenance recommendations" |
| SonosIntent | Control Sonos | "play music in the living room" |

### Network Requirements

The Lambda function needs to reach your home assistant's webhook endpoint.
Options:
- **ngrok** or **Cloudflare Tunnel** for development
- **Port forwarding** on your router (not recommended for production)
- **VPN** or **Tailscale** for secure access
- **Deploy on a cloud VM** with a public IP
