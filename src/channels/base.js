/**
 * Base channel interface. All input/output channels implement this.
 * Channels handle receiving messages from users and sending responses back.
 */
export class BaseChannel {
  constructor(name, config) {
    this.name = name;
    this.config = config;
  }

  /** Start listening for incoming messages */
  async start() { throw new Error('Not implemented'); }

  /** Stop the channel */
  async stop() { throw new Error('Not implemented'); }

  /** Send a text message to the user */
  async sendText(userId, text) { throw new Error('Not implemented'); }

  /** Send a voice/audio message to the user */
  async sendVoice(userId, audioBuffer) { throw new Error('Not implemented'); }

  /** Send a rich message (images, cards, etc.) */
  async sendRich(userId, content) { throw new Error('Not implemented'); }
}
