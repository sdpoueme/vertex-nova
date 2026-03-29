/**
 * Output Router — sends responses to the appropriate device/channel.
 *
 * The AI can specify where to send output via directives in its response:
 *   [output:sonos] Play this on the Sonos system
 *   [output:echo:living-room] Announce on the living room Echo
 *   [output:fire-tv] Display on Fire TV
 *   [output:echo-show] Show on Echo Show
 *
 * By default, responses go back to the originating channel.
 */
import { SonosOutput } from './sonos.js';
import { AlexaDeviceOutput } from './alexa-devices.js';
import { logger } from '../log.js';

const log = logger('output-router');

// Regex to extract output directives from AI responses
const OUTPUT_DIRECTIVE = /\[output:([^\]]+)\]/gi;

export class OutputRouter {
  constructor(config) {
    this.config = config;
    this.sonos = null;
    this.alexaDevices = config.alexaSmartHomeEnabled ? new AlexaDeviceOutput(config) : null;
    this.channels = new Map();

    if (config.sonosEnabled) {
      this.sonos = new SonosOutput(config);
      // Configure local TTS if Piper is available
      if (config.ttsModel) {
        this.sonos.configureTts({
          piperPath: config.ttsPath,
          frModel: config.ttsFrModel || config.ttsModel,
          enModel: config.ttsModel,
          port: config.ttsServerPort || 3004,
        });
      }
    }
  }

  registerChannel(name, channel) {
    this.channels.set(name, channel);
  }

  /**
   * Route a response to the appropriate output(s).
   * 
   * @param {string} response - The AI's response text (may contain output directives)
   * @param {object} context - The original message context
   * @returns {string} The cleaned response (directives stripped)
   */
  async route(response, context) {
    const directives = [];
    let cleanResponse = response.replace(OUTPUT_DIRECTIVE, (match, target) => {
      directives.push(target.trim().toLowerCase());
      return '';
    }).trim();

    // If no directives, reply on the originating channel
    if (directives.length === 0) {
      return { text: cleanResponse, targets: ['origin'] };
    }

    // Process each directive
    for (const directive of directives) {
      try {
        await this._sendToTarget(directive, cleanResponse, context);
      } catch (err) {
        log.error(`Failed to send to ${directive}:`, err.message);
      }
    }

    return { text: cleanResponse, targets: directives };
  }

  async _sendToTarget(target, text, context) {
    // Sonos
    if (target === 'sonos' || target.startsWith('sonos:')) {
      const room = target.includes(':') ? target.split(':')[1] : null;
      if (this.sonos) {
        await this.sonos.speak(text, room);
      } else {
        log.warn('Sonos output not configured');
      }
      return;
    }

    // Echo devices (announce via Alexa)
    if (target === 'echo' || target.startsWith('echo:')) {
      const device = target.includes(':') ? target.split(':')[1] : null;
      if (this.alexaDevices) {
        await this.alexaDevices.announce(text, device);
      } else {
        log.warn('Alexa device output not configured');
      }
      return;
    }

    // Echo Show (visual + voice)
    if (target === 'echo-show' || target.startsWith('echo-show:')) {
      const device = target.includes(':') ? target.split(':')[1] : null;
      if (this.alexaDevices) {
        await this.alexaDevices.showAndTell(text, device);
      } else {
        log.warn('Alexa device output not configured');
      }
      return;
    }

    // Fire TV (display notification)
    if (target === 'fire-tv' || target.startsWith('fire-tv:')) {
      const device = target.includes(':') ? target.split(':')[1] : null;
      if (this.alexaDevices) {
        await this.alexaDevices.notify(text, device);
      } else {
        log.warn('Alexa device output not configured');
      }
      return;
    }

    log.warn(`Unknown output target: ${target}`);
  }
}
