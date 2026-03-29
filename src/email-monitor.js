/**
 * Email Monitor — polls a Gmail inbox for device notifications.
 * Parses emails from smart home services (Telus, MyQ, Honeywell, Ring)
 * and forwards them to the AI for analysis and vault logging.
 */
import { logger } from './log.js';

var log = logger('email');

var GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class EmailMonitor {
  constructor(config, onEvent) {
    this.email = config.emailMonitorAddress || '';
    this.password = config.emailMonitorPassword || '';
    this.pollInterval = config.emailPollInterval || 60000; // 1 minute
    this.onEvent = onEvent;
    this._timer = null;
    this._lastCheck = new Date();
    // Use IMAP via fetch to Gmail API with OAuth or App Password
    // Simpler approach: use Gmail API with app password via basic auth
  }

  async start() {
    if (!this.email || !this.password) {
      log.info('Email monitor not configured (EMAIL_MONITOR_ADDRESS not set)');
      return;
    }
    log.info('Email monitor started, polling every ' + (this.pollInterval / 1000) + 's');
    this._timer = setInterval(this._poll.bind(this), this.pollInterval);
    // Initial poll
    await this._poll();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  async _poll() {
    try {
      var emails = await this._fetchNewEmails();
      for (var i = 0; i < emails.length; i++) {
        await this._processEmail(emails[i]);
      }
    } catch (err) {
      log.error('Email poll error: ' + err.message);
    }
  }

  async _fetchNewEmails() {
    // Use IMAP-like approach via node's built-in fetch
    // Gmail supports IMAP but we'll use a simpler approach:
    // Poll Gmail via Google Apps Script or Gmail API
    // For simplicity, we use Gmail's Atom feed with basic auth
    var auth = Buffer.from(this.email + ':' + this.password).toString('base64');
    var res = await fetch('https://mail.google.com/mail/feed/atom', {
      headers: { 'Authorization': 'Basic ' + auth },
    });

    if (!res.ok) {
      if (res.status === 401) {
        log.error('Gmail auth failed. Check EMAIL_MONITOR_ADDRESS and EMAIL_MONITOR_PASSWORD (use App Password)');
      }
      throw new Error('Gmail feed error: ' + res.status);
    }

    var xml = await res.text();
    return this._parseAtomFeed(xml);
  }

  _parseAtomFeed(xml) {
    var emails = [];
    var entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    var match;

    while ((match = entryRegex.exec(xml)) !== null) {
      var entry = match[1];
      var title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      var summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || '';
      var author = (entry.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || '';
      var issued = (entry.match(/<issued>([\s\S]*?)<\/issued>/) || [])[1] || '';
      var id = (entry.match(/<id>([\s\S]*?)<\/id>/) || [])[1] || '';

      var emailDate = new Date(issued);
      if (emailDate > this._lastCheck) {
        emails.push({
          id: id,
          from: author,
          subject: title,
          summary: summary.trim(),
          date: issued,
        });
      }
    }

    if (emails.length > 0) {
      this._lastCheck = new Date();
      log.info('Found ' + emails.length + ' new email(s)');
    }

    return emails;
  }

  async _processEmail(email) {
    log.info('Processing email from ' + email.from + ': ' + email.subject);

    // Classify the email source
    var source = 'unknown';
    var fromLower = (email.from + ' ' + email.subject).toLowerCase();

    if (fromLower.includes('telus') || fromLower.includes('smarthome') || fromLower.includes('alarm')) {
      source = 'telus-security';
    } else if (fromLower.includes('myq') || fromLower.includes('chamberlain') || fromLower.includes('liftmaster') || fromLower.includes('garage')) {
      source = 'myq-garage';
    } else if (fromLower.includes('honeywell') || fromLower.includes('resideo') || fromLower.includes('thermostat')) {
      source = 'honeywell-thermostat';
    } else if (fromLower.includes('ring') || fromLower.includes('doorbell') || fromLower.includes('camera')) {
      source = 'ring-camera';
    }

    var eventText = '[Home Device Alert — ' + source + ']\n' +
      'From: ' + email.from + '\n' +
      'Subject: ' + email.subject + '\n' +
      'Summary: ' + email.summary + '\n' +
      'Date: ' + email.date + '\n\n' +
      'Analyze this alert. If it indicates an anomaly or issue, log it as a home event in the vault. ' +
      'If it is routine (e.g., normal arm/disarm), just acknowledge it briefly.';

    // Forward to the AI handler
    if (this.onEvent) {
      await this.onEvent({
        channel: 'email-monitor',
        type: 'text',
        text: eventText,
        userId: 'system',
        source: source,
      });
    }
  }
}
