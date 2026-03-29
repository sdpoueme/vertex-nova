/**
 * Voice Monkey — make Alexa Echo devices speak via the Voice Monkey API.
 * Uses POST requests to the announcement endpoint.
 */
import { logger } from '../log.js';

var log = logger('voicemonkey');
var API_URL = 'https://api-v2.voicemonkey.io/announcement';

export class VoiceMonkey {
  constructor(config) {
    this.token = config.voiceMonkeyToken || '';
    this.defaultDevice = config.voiceMonkeyDefaultDevice || '';
  }

  /**
   * Make an Echo device speak text.
   * @param {string} text - Text to speak
   * @param {string} [device] - Voice Monkey device ID (e.g. "vertexnovaspeaker")
   */
  async speak(text, device) {
    var target = device || this.defaultDevice;
    if (!target) {
      log.error('No Voice Monkey device specified');
      return false;
    }
    if (!this.token) {
      log.error('No Voice Monkey token configured');
      return false;
    }

    try {
      var res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: this.token,
          device: target,
          text: text.slice(0, 1000),
        }),
      });

      var data = await res.json();
      if (data.success) {
        log.info('Echo speak → ' + target + ': ' + text.slice(0, 80));
        return true;
      } else {
        log.error('Voice Monkey error: ' + JSON.stringify(data));
        return false;
      }
    } catch (err) {
      log.error('Voice Monkey request failed: ' + err.message);
      return false;
    }
  }

  /**
   * Speak on all configured Echo devices.
   */
  async speakAll(text, devices) {
    var results = [];
    for (var i = 0; i < devices.length; i++) {
      results.push(await this.speak(text, devices[i]));
    }
    return results;
  }
}
