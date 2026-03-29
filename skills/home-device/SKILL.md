---
name: home-device
description: "Add or update a device in the home inventory"
argument-hint: "<device name and details>"
---

# Home Device Management

When the user wants to add or update a device:

1. Extract device details: name, type, brand, model, location, purchase date, warranty
2. Check if a note already exists in `home/devices/` for this device
3. If new: create a device note with proper frontmatter (device_type, brand, model, location, purchase_date, warranty_until, tags)
4. If existing: update the relevant fields
5. Link the device to its location in `home/topology/` if that note exists
6. Append a log entry to today's daily note

Device types: appliance, smart-home, hvac, plumbing, electrical, security, entertainment, networking
