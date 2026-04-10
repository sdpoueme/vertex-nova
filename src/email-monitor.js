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

    // Match against configured device email sources
    var matchedDevice = null;
    var fromLower = (email.from + ' ' + email.subject + ' ' + email.summary).toLowerCase();

    try {
      var { getDeviceApps } = await import('./notification-monitor.js');
      var apps = getDeviceApps();
      for (var bid in apps) {
        var app = apps[bid];
        var sources = app.sources || [];
        for (var s of sources) {
          if (s.type !== 'email') continue;
          var fromMatch = s.from && fromLower.includes(s.from.toLowerCase());
          var keywordMatch = s.keywords && s.keywords.some(function(kw) { return fromLower.includes(kw.toLowerCase()); });
          if (fromMatch || keywordMatch) { matchedDevice = app; break; }
        }
        if (matchedDevice) break;
      }
    } catch {}

    // Fallback to legacy matching if no config match
    var source = matchedDevice ? matchedDevice.name : 'unknown';
    if (!matchedDevice) {
      if (fromLower.includes('telus') || fromLower.includes('smarthome') || fromLower.includes('alarm')) source = 'Telus';
      else if (fromLower.includes('myq') || fromLower.includes('chamberlain') || fromLower.includes('garage')) source = 'MyQ';
      else if (fromLower.includes('honeywell') || fromLower.includes('resideo') || fromLower.includes('thermostat')) source = 'Honeywell';
      else if (fromLower.includes('ring') || fromLower.includes('doorbell')) source = 'Ring';
      else if (fromLower.includes('lg') || fromLower.includes('thinq')) source = 'LG ThinQ';
      else if (fromLower.includes('bosch') || fromLower.includes('homeconnect')) source = 'Bosch';
    }

    var icon = matchedDevice ? matchedDevice.icon : '📧';
    var context = matchedDevice ? matchedDevice.context : '';

    var eventText = '[Email: ' + source + '] ' + icon + '\n' +
      'De: ' + email.from + '\n' +
      'Sujet: ' + email.subject + '\n' +
      'Résumé: ' + email.summary + '\n' +
      'Date: ' + email.date + '\n' +
      (context ? 'Contexte: ' + context + '\n' : '') +
      '\nAnalyse cette alerte. Si c\'est une anomalie ou un problème, résume en français. Si c\'est routine, réponds "SKIP".';

    if (this.onEvent) {
      await this.onEvent({
        channel: 'email-monitor',
        type: 'text',
        text: eventText,
        userId: 'system',
        source: source,
        icon: icon,
      });
    }
  }
}
