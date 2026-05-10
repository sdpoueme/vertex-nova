# Mode: Hospitalité (Airbnb & Hôtel)

Transforms Vertex Nova into a guest concierge. Two sub-modes available: Airbnb (single guest/group) and Hôtel (multi-room with individual guests).

## Switching Modes

From the admin dashboard: Configuration → Hospitalité → select mode.

Or via API:
```bash
curl -X PUT https://localhost:3080/api/hospitality/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode": "hotel"}'
```

When switching to a hospitality mode:
- A guest portal starts on a dedicated port (3081 or 3082)
- The admin dashboard adapts its layout (hospitality-focused tabs)
- Model routing switches to `config/routing-hospitality.yaml`
- Proactive actions switch to `config/proactive-hospitality.yaml`
- Dream engine is disabled
- Guest interactions are privacy-isolated from the admin view

---

## What Changes in Hospitality Mode

| Aspect | Résidence | Hospitalité |
|--------|-----------|-------------|
| Dashboard home | Family status, presence, KBs | Occupancy, portal link, admin-only interactions |
| Config tabs | Models, Family, Hospitalité, Routing, Proactive, Prompt | Guest management, Routing (hospitality), Proactive (hospitality), Models |
| Navigation | Chat, Connaissances, Appareils, Logs | Chat admin, Appareils, Logs |
| Interactions shown | All channels | Admin only (guest conversations hidden) |
| Dream engine | Active (1-5 AM) | Disabled |
| Routing config | `config/routing.yaml` | `config/routing-hospitality.yaml` |
| Proactive config | `config/proactive.yaml` | `config/proactive-hospitality.yaml` |

---

## Airbnb Mode

For entire-home or private-room short-term rentals. One guest (or group) at a time.

### Admin Workflow

1. Switch to Airbnb mode in the dashboard
2. Fill in guest details: name, email, language, check-in/out dates
3. Configure house info: WiFi, rules, emergency contacts, local info
4. Generate an access code (click "Générer")
5. Send the code to the guest by email (click "Envoyer par email")
6. Guest accesses portal at `https://<your-ip>:3081`, enters code
7. At checkout, code auto-expires. Revoke manually if needed.

### Guest Portal (Port 3081)

Built with Cloudscape UI. After authentication, the guest sees:

| Tab | Content |
|-----|---------|
| Info | WiFi credentials, house rules, emergency contacts, checkout time |
| Chat | AI concierge (limited access — no family data, no emails, no security) |
| Local | Restaurant, transport, and activity recommendations |

The guest cannot:
- Access the admin dashboard
- See family data, emails, or security devices
- Control security devices (locks, cameras, alarm)
- Read other guests' history

### Access Code

- 6-character hex code (e.g. `A1B2C3`)
- Auto-expires at checkout date (23:59)
- Can be revoked anytime from the dashboard
- Sent to guest via email with portal URL and stay info

### Configuration

All in `config/hospitality.yaml` under the `airbnb:` section:

```yaml
airbnb:
  port: 3081
  listing_type: entire_home
  guest:
    name: "John Smith"
    email: "john@email.com"
    language: en
    check_in: "2026-05-15"
    check_out: "2026-05-20"
    code: "A1B2C3"
  info:
    wifi_name: "MyWiFi"
    wifi_password: "password123"
    rules: |
      - No parties
      - Quiet after 10 PM
    emergency_contacts: |
      Emergency: 911
      Host: 514-xxx-xxxx
    local_info: |
      Restaurants, transport, activities...
    checkout_time: "11:00"
```

---

## Hôtel Mode

For multi-room setups with individual guest management. Each room has its own guest, devices, and amenities.

### Admin Workflow

1. Switch to Hôtel mode in the dashboard
2. Rooms are defined in `config/hospitality.yaml` (name, floor, devices, amenities)
3. To enroll a guest:
   - Click "Enregistrer un guest" (top-level button) or "Check-in" on a vacant room
   - Fill in: name, email, language, arrival/departure dates
   - Toggle "Envoyer un email de bienvenue" (sends portal URL, WiFi, room info)
   - Click "Confirmer le check-in"
4. Guest receives welcome email and can access the portal
5. To checkout: click "Checkout" on the room card

### Guest Portal (Port 3082)

Same Cloudscape UI as Airbnb, but login uses **name + room name** instead of a code.

The guest enters:
- Their full name (as registered by admin)
- The room name (e.g. "Chambre Bleue")

After login, they see their room info, WiFi, rules, and can chat with the AI concierge.

### Guest Enrollment

The enrollment form collects:

| Field | Purpose |
|-------|---------|
| Name | Portal login + display. Must match exactly. |
| Email | Welcome email with all access info |
| Language | AI concierge responds in this language |
| Arrival | Check-in date |
| Departure | Check-out date (access expires after this) |
| Send email | Toggle to auto-send welcome email on enrollment |

The welcome email includes:
- Room name and amenities
- WiFi credentials
- Portal URL and login instructions
- Stay dates
- Available on the portal: AI assistant, local info, device control

### Room Configuration

Rooms are defined in `config/hospitality.yaml`:

```yaml
hotel:
  port: 3082
  name: "Maison Poueme"
  rooms:
    - id: chambre-2
      name: "Chambre Bleue"
      floor: upper
      devices:
        - Echo Bedroom 2
      amenities:
        - WiFi
        - Serviettes
        - Climatisation
      guest:
        name: ""
        language: auto
        check_in: ""
        check_out: ""

    - id: chambre-3
      name: "Chambre Verte"
      floor: upper
      devices:
        - Echo Bedroom 3
      amenities:
        - WiFi
        - Serviettes
        - Vue jardin
      guest:
        name: ""
        language: auto
        check_in: ""
        check_out: ""

  info:
    wifi_name: "GuestWiFi"
    wifi_password: "welcome123"
    rules: "Quiet after 10 PM. Breakfast 7-9 AM."
    emergency_contacts: "911"
    local_info: ""
    breakfast_hours: "07:00-09:00"
```

### Hotel Info for Guests

The "Infos pour les guests" section in the dashboard lets you configure:
- WiFi name and password
- House rules
- Emergency contacts
- Local info (restaurants, transport — can be AI-generated)

This info is shown to all hotel guests on their portal.

---

## Privacy Model

Guest privacy is enforced at multiple levels:

| Layer | Protection |
|-------|-----------|
| Portal isolation | Guest portal runs on a separate port, separate server process |
| Chat isolation | Guest conversations use separate session IDs, never logged to admin history |
| API filtering | `/api/history` filters out guest interactions in hospitality mode |
| Dashboard | Admin dashboard explicitly states "guest conversations are private" |
| Tool restriction | Guest chat has no access to: family data, emails, security devices, vault, memory |
| Data retention | Guest history anonymized (first initial only) after checkout |

---

## Proactive Actions (Hospitality)

In hospitality mode, proactive actions switch to `config/proactive-hospitality.yaml`:

| Action | Description |
|--------|-------------|
| checkout-reminder | Reminds guests on checkout day (8-10 AM) |
| guest-welcome-check | Verifies new guests received their welcome email |
| quiet-hours-monitor | Monitors audio devices during quiet hours (10 PM - 7 AM) |

---

## Model Routing (Hospitality)

Simplified routing in `config/routing-hospitality.yaml`:
- All guest chat → Qwen3 8B
- Vision requests → Qwen2.5-VL 7B
- Complex/urgent → Claude (escalation)

No family-specific tools, no email tools, no security device access.

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/hospitality` | GET | Current mode and status |
| `/api/hospitality/mode` | PUT | Switch mode (`{"mode": "hotel"}`) |
| `/api/hospitality/guest-code` | POST | Generate Airbnb access code |
| `/api/hospitality/send-code-email` | POST | Email the code to the guest |
| `/api/hospitality/revoke` | POST | Revoke guest access |
| `/api/hospitality/config` | PUT | Save hospitality config (WiFi, rules, etc.) |
| `/api/hospitality/hotel/rooms` | GET | List rooms with occupancy |
| `/api/hospitality/hotel/guests` | POST | Assign guest to room |
| `/api/hospitality/hotel/guests/:roomId` | DELETE | Checkout guest from room |
| `/api/hospitality/generate-local-info` | POST | AI-generate local recommendations |
