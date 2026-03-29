/**
 * Alexa channel — receives requests from an Alexa Custom Skill.
 *
 * Architecture:
 *   Alexa Skill → Lambda/HTTPS endpoint → this webhook server
 *
 * The Alexa skill sends user utterances here, and we return text responses
 * that Alexa speaks back. For proactive notifications, we use the
 * Alexa Proactive Events API or Alexa Notifications API.
 *
 * Requires:
 *   ALEXA_SKILL_ID       - Your Alexa Skill ID (for request validation)
 *   ALEXA_WEBHOOK_PORT   - Port for the webhook server (default: 3002)
 *
 * Setup:
 *   1. Create a custom Alexa Skill in the Alexa Developer Console
 *   2. Set the skill endpoint to https://your-domain:port/alexa
 *   3. Define intents: HomeAssistantIntent (with a {query} slot),
 *      plus standard AMAZON.StopIntent, AMAZON.HelpIntent, etc.
 */
import { createServer } from 'node:http';
import { BaseChannel } from './base.js';
import { stripForSpeech } from '../format.js';
import { logger } from '../log.js';

const log = logger('alexa');

export class AlexaChannel extends BaseChannel {
  constructor(config, messageHandler) {
    super('alexa', config);
    this.messageHandler = messageHandler;
    this.server = null;
    // Store pending responses keyed by request ID
    this._pending = new Map();
  }

  async start() {
    const port = this.config.alexaWebhookPort || 3002;

    this.server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/alexa') {
        return this._handleRequest(req, res);
      }
      res.writeHead(404);
      res.end('Not found');
    });

    this.server.listen(port, () => {
      log.info(`Alexa webhook listening on port ${port}`);
    });
  }

  async stop() {
    if (this.server) this.server.close();
    this._pending.clear();
  }

  async _handleRequest(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const request = JSON.parse(body);

        // Validate skill ID if configured
        if (this.config.alexaSkillId) {
          const appId = request.session?.application?.applicationId;
          if (appId !== this.config.alexaSkillId) {
            log.warn(`Rejected request from unknown skill: ${appId}`);
            res.writeHead(403);
            res.end('Forbidden');
            return;
          }
        }

        const response = await this._processAlexaRequest(request);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err) {
        log.error('Alexa request error:', err.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this._buildResponse('Sorry, something went wrong.', true)));
      }
    });
  }

  async _processAlexaRequest(request) {
    const requestType = request.request?.type;
    const userId = request.session?.user?.userId || 'alexa-user';

    if (requestType === 'LaunchRequest') {
      return this._buildResponse('Home assistant is ready. What can I help you with?', false);
    }

    if (requestType === 'SessionEndedRequest') {
      return this._buildResponse('', true);
    }

    if (requestType === 'IntentRequest') {
      const intentName = request.request.intent?.name;

      if (intentName === 'AMAZON.StopIntent' || intentName === 'AMAZON.CancelIntent') {
        return this._buildResponse('Goodbye.', true);
      }

      if (intentName === 'AMAZON.HelpIntent') {
        return this._buildResponse(
          'You can ask me about your home, check on tasks, report events like power outages, or ask for recommendations. What would you like to do?',
          false
        );
      }

      // HomeAssistantIntent — the main catch-all intent
      if (intentName === 'HomeAssistantIntent') {
        const query = request.request.intent.slots?.query?.value;
        if (!query) {
          return this._buildResponse("I didn't catch that. Could you say it again?", false);
        }
        return this._forwardToAI(query, userId);
      }

      // HomeStatusIntent — quick home overview
      if (intentName === 'HomeStatusIntent') {
        return this._forwardToAI('Give me a home status overview — pending tasks, recent events, upcoming maintenance.', userId);
      }

      // HomeEventIntent — log a home event
      if (intentName === 'HomeEventIntent') {
        const eventType = request.request.intent.slots?.eventType?.value || 'event';
        const details = request.request.intent.slots?.details?.value || '';
        const query = `Log a home event: ${eventType}${details ? '. Details: ' + details : '. Ask me for more details.'}`;
        return this._forwardToAI(query, userId);
      }

      // HomeRecommendIntent — get recommendations
      if (intentName === 'HomeRecommendIntent') {
        const area = request.request.intent.slots?.area?.value || '';
        const query = area
          ? `Give me home maintenance recommendations for ${area}.`
          : 'Give me home maintenance recommendations.';
        return this._forwardToAI(query, userId);
      }

      // SonosIntent — control Sonos
      if (intentName === 'SonosIntent') {
        const action = request.request.intent.slots?.action?.value || '';
        const room = request.request.intent.slots?.room?.value || '';
        const query = `Sonos: ${action}${room ? ' in ' + room : ''}`;
        return this._forwardToAI(query, userId);
      }

      // FallbackIntent
      if (intentName === 'AMAZON.FallbackIntent') {
        return this._buildResponse("I didn't understand that. You can ask me about your home, report events, or get recommendations.", false);
      }

      // Unknown intent
      return this._buildResponse("I'm not sure how to help with that. Try asking differently.", false);
    }

    return this._buildResponse('', true);
  }

  /**
   * Forward a query to the AI and return an Alexa-formatted response.
   */
  async _forwardToAI(query, userId) {
    try {
      const responsePromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Response timeout'));
        }, this.config.claudeTimeout || 30000);

        this.messageHandler({
          channel: 'alexa',
          type: 'text',
          text: query,
          userId,
          resolve: (text) => {
            clearTimeout(timeout);
            resolve(text);
          },
        });
      });

      const responseText = await responsePromise;
      const spoken = stripForSpeech(responseText);
      // Alexa has an 8000 char limit for SSML output
      const truncated = spoken.length > 6000
        ? spoken.slice(0, 6000) + '... I have more details if you want.'
        : spoken;
      return this._buildResponse(truncated, false);
    } catch (err) {
      log.error('Alexa processing error:', err.message);
      return this._buildResponse('Sorry, I took too long to respond. Try again.', false);
    }
  }

  _buildResponse(text, shouldEndSession) {
    const response = {
      version: '1.0',
      response: {
        shouldEndSession,
      },
    };

    if (text) {
      response.response.outputSpeech = {
        type: 'PlainText',
        text,
      };
    }

    return response;
  }

  async sendText(userId, text) {
    // Alexa is request-response, so text is sent in the response.
    // For proactive messages, we'd use the Alexa Proactive Events API.
    log.debug(`Alexa sendText called (proactive messaging not yet implemented)`);
  }

  async sendVoice(userId, audioBuffer) {
    // Alexa handles TTS natively — we just send text
    log.debug('Alexa handles TTS natively');
    return false;
  }
}
