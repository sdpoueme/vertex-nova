/**
 * Alexa Device Output — send announcements, notifications, and visual content
 * to Echo, Echo Show, and Fire TV devices.
 *
 * Uses the Alexa Smart Home API / Alexa Proactive Events API.
 * 
 * For local network control, this can also use alexa-remote2 or similar
 * libraries that interface with the Alexa ecosystem.
 *
 * Requires:
 *   ALEXA_COOKIE or ALEXA_REFRESH_TOKEN - Authentication for Alexa API
 *   ALEXA_REGION                        - e.g., "us-east-1" (default)
 *
 * Device types and capabilities:
 *   - Echo:      Voice announcements, routines
 *   - Echo Show: Voice + visual cards, images, video
 *   - Fire TV:   Notifications, visual overlays
 */
import { logger } from '../log.js';

const log = logger('alexa-devices');

export class AlexaDeviceOutput {
  constructor(config) {
    this.config = config;
    this.devices = new Map(); // device name → device info
    this._initialized = false;
  }

  /**
   * Announce text on an Echo device (plays on speaker).
   * @param {string} text - Text to announce
   * @param {string} [deviceName] - Specific device, or null for all
   */
  async announce(text, deviceName) {
    log.info(`Announce on ${deviceName || 'all Echo devices'}: ${text.slice(0, 100)}...`);

    // Using Alexa Announcements API
    // This requires the Alexa Smart Home Skill or Proactive Events API
    // For now, we log the intent — actual implementation depends on
    // which Alexa API approach you choose:
    //
    // Option A: Alexa Proactive Events API (requires skill with proactive events permission)
    // Option B: alexa-remote2 npm package (uses cookie-based auth, unofficial)
    // Option C: Home Assistant integration (if you run HA alongside)
    //
    // The recommended approach is Option B for local control:
    //
    // const Alexa = require('alexa-remote2');
    // alexa.sendSequenceCommand(deviceSerial, 'speak', text);

    try {
      if (this.config.alexaApiUrl) {
        // If using a local Alexa API proxy (like alexa-remote2-http)
        const res = await fetch(`${this.config.alexaApiUrl}/announce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            device: deviceName || null,
          }),
        });
        if (!res.ok) log.error(`Alexa announce failed: ${res.status}`);
        else log.info('Alexa announcement sent');
      } else {
        log.warn('ALEXA_API_URL not configured — announcement not sent');
      }
    } catch (err) {
      log.error('Alexa announce error:', err.message);
    }
  }

  /**
   * Show visual content + speak on an Echo Show device.
   * @param {string} text - Text to display and speak
   * @param {string} [deviceName] - Specific Echo Show device
   */
  async showAndTell(text, deviceName) {
    log.info(`Show+Tell on ${deviceName || 'Echo Show'}: ${text.slice(0, 100)}...`);

    try {
      if (this.config.alexaApiUrl) {
        const res = await fetch(`${this.config.alexaApiUrl}/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            device: deviceName || null,
            type: 'text-card',
          }),
        });
        if (!res.ok) log.error(`Alexa show failed: ${res.status}`);
      } else {
        log.warn('ALEXA_API_URL not configured');
      }
    } catch (err) {
      log.error('Alexa show error:', err.message);
    }
  }

  /**
   * Send a notification to a Fire TV device.
   * @param {string} text - Notification text
   * @param {string} [deviceName] - Specific Fire TV device
   */
  async notify(text, deviceName) {
    log.info(`Fire TV notification on ${deviceName || 'all'}: ${text.slice(0, 100)}...`);

    try {
      if (this.config.alexaApiUrl) {
        const res = await fetch(`${this.config.alexaApiUrl}/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            device: deviceName || null,
          }),
        });
        if (!res.ok) log.error(`Fire TV notify failed: ${res.status}`);
      } else {
        log.warn('ALEXA_API_URL not configured');
      }
    } catch (err) {
      log.error('Fire TV notify error:', err.message);
    }
  }

  /**
   * List available Alexa devices.
   */
  async listDevices() {
    try {
      if (this.config.alexaApiUrl) {
        const res = await fetch(`${this.config.alexaApiUrl}/devices`);
        if (!res.ok) throw new Error(`${res.status}`);
        return await res.json();
      }
      return [];
    } catch (err) {
      log.error('Failed to list Alexa devices:', err.message);
      return [];
    }
  }
}
