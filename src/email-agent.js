/**
 * Email Agent — monitors inbox, notifies on Telegram, drafts replies, sends on approval.
 *
 * Flow:
 * 1. Poll Gmail Atom feed for new emails
 * 2. Notify owner on Telegram with summary + "Répondre?" button
 * 3. If owner says yes, AI drafts a reply
 * 4. Draft shown on Telegram for approval
 * 5. On approval, send via SMTP
 *
 * Uses Gmail App Password for both reading (Atom feed) and sending (SMTP).
 */
import { logger } from './log.js';
import { createTransport } from 'nodemailer';

var log = logger('email-agent');

var pendingDrafts = new Map(); // emailId → { from, subject, body, draft, replyTo }
var processedIds = new Set();
var MAX_PROCESSED = 500;

export class EmailAgent {
  constructor(config, opts) {
    this.email = config.emailMonitorAddress || '';
    this.password = config.emailMonitorPassword || '';
    this.pollInterval = config.emailPollInterval || 60000;
    this.onNotify = opts.onNotify; // (text) => send to Telegram
    this.onAskAI = opts.onAskAI;  // (prompt, sessionId) => AI response
    this._timer = null;
    this._lastCheck = new Date();
    this._smtpTransport = null;
  }

  _getSmtp() {
    if (!this._smtpTransport && this.email && this.password) {
      this._smtpTransport = createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: this.email, pass: this.password },
      });
    }
    return this._smtpTransport;
  }

  async start() {
    if (!this.email || !this.password) {
      log.info('Email agent not configured');
      return;
    }
    log.info('Email agent started (poll: ' + (this.pollInterval / 1000) + 's, address: ' + this.email + ')');
    this._timer = setInterval(() => this._poll(), this.pollInterval);
    await this._poll();
  }

  stop() { if (this._timer) clearInterval(this._timer); }

  async _poll() {
    try {
      var emails = await this._fetchNewEmails();
      for (var em of emails) {
        if (processedIds.has(em.id)) continue;
        processedIds.add(em.id);
        if (processedIds.size > MAX_PROCESSED) {
          var arr = Array.from(processedIds);
          processedIds = new Set(arr.slice(-200));
        }
        await this._handleNewEmail(em);
      }
    } catch (err) {
      log.error('Email poll error: ' + err.message);
    }
  }

  async _fetchNewEmails() {
    var auth = Buffer.from(this.email + ':' + this.password).toString('base64');
    var res = await fetch('https://mail.google.com/mail/feed/atom', {
      headers: { Authorization: 'Basic ' + auth },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      if (res.status === 401) log.error('Gmail auth failed — check app password');
      throw new Error('Gmail ' + res.status);
    }
    var xml = await res.text();
    return this._parseAtomFeed(xml);
  }

  _parseAtomFeed(xml) {
    var emails = [];
    var regex = /<entry>([\s\S]*?)<\/entry>/g;
    var m;
    while ((m = regex.exec(xml)) !== null) {
      var e = m[1];
      var title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      var summary = (e.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || '';
      var author = (e.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || '';
      var authorEmail = (e.match(/<email>([\s\S]*?)<\/email>/) || [])[1] || '';
      var issued = (e.match(/<issued>([\s\S]*?)<\/issued>/) || [])[1] || '';
      var id = (e.match(/<id>([\s\S]*?)<\/id>/) || [])[1] || '';
      var emailDate = new Date(issued);
      if (emailDate > this._lastCheck) {
        emails.push({ id, from: author, fromEmail: authorEmail, subject: title, summary: summary.trim(), date: issued });
      }
    }
    if (emails.length > 0) {
      this._lastCheck = new Date();
      log.info('Found ' + emails.length + ' new email(s)');
    }
    return emails;
  }

  async _handleNewEmail(email) {
    // Skip no-reply, notifications, newsletters
    var fromLower = (email.from + ' ' + email.fromEmail + ' ' + email.subject).toLowerCase();
    var isNoReply = /noreply|no-reply|donotreply|notification|newsletter|unsubscribe|mailer-daemon/i.test(fromLower);

    // Store for potential reply
    var emailKey = email.id.replace(/[^a-zA-Z0-9]/g, '').slice(-12);
    pendingDrafts.set(emailKey, {
      from: email.from,
      fromEmail: email.fromEmail,
      subject: email.subject,
      body: email.summary,
      draft: null,
      approved: false,
    });

    // Build notification
    var icon = isNoReply ? '📬' : '📧';
    var msg = icon + ' Nouvel email\n' +
      'De: ' + email.from + (email.fromEmail ? ' <' + email.fromEmail + '>' : '') + '\n' +
      'Sujet: ' + email.subject + '\n';
    if (email.summary) msg += 'Aperçu: ' + email.summary.slice(0, 200) + '\n';

    if (isNoReply) {
      // Notification-only emails — just inform, no reply option
      msg += '\n(notification automatique, pas de réponse possible)';
      log.info('Email notification: ' + email.subject + ' from ' + email.from);
    } else {
      // Replyable email — offer to draft a response
      msg += '\nPour répondre, envoyez: répondre ' + emailKey;
      log.info('Email replyable: ' + email.subject + ' from ' + email.from + ' [' + emailKey + ']');
    }

    if (this.onNotify) await this.onNotify(msg);
  }

  /**
   * Handle a reply request from the user.
   * @param {string} emailKey - The email key from the notification
   * @param {string} [userInstructions] - Optional instructions for the draft
   * @returns {string} The draft or error message
   */
  async draftReply(emailKey, userInstructions) {
    var pending = pendingDrafts.get(emailKey);
    if (!pending) return 'Email non trouvé. Le code ' + emailKey + ' a peut-être expiré.';

    var prompt = 'Rédige une réponse professionnelle et concise à cet email.\n\n' +
      'De: ' + pending.from + ' <' + pending.fromEmail + '>\n' +
      'Sujet: ' + pending.subject + '\n' +
      'Contenu: ' + pending.body + '\n\n';
    if (userInstructions) prompt += 'Instructions: ' + userInstructions + '\n\n';
    prompt += 'Écris UNIQUEMENT le corps de la réponse (pas de "Objet:", pas de salutation "De:"). ' +
      'Commence directement par la salutation (Bonjour, Hi, etc.). ' +
      'Adapte la langue à celle de l\'email original. Sois professionnel mais naturel.';

    try {
      var draft = await this.onAskAI(prompt, 'email-draft-' + emailKey);
      // Clean up any AI artifacts
      draft = draft.replace(/^(Objet|Subject|De|From|À|To):.*\n/gm, '').trim();
      pending.draft = draft;
      pendingDrafts.set(emailKey, pending);

      var preview = '✏️ Brouillon de réponse à ' + pending.from + ':\n' +
        'Sujet: Re: ' + pending.subject + '\n\n' +
        draft + '\n\n' +
        'Pour envoyer: envoyer ' + emailKey + '\n' +
        'Pour modifier: répondre ' + emailKey + ' [vos instructions]';
      return preview;
    } catch (err) {
      log.error('Draft failed: ' + err.message);
      return 'Erreur lors de la rédaction: ' + err.message;
    }
  }

  /**
   * Send an approved draft.
   * @param {string} emailKey
   * @returns {string} Confirmation or error
   */
  async sendReply(emailKey) {
    var pending = pendingDrafts.get(emailKey);
    if (!pending) return 'Email non trouvé.';
    if (!pending.draft) return 'Pas de brouillon. Utilisez d\'abord: répondre ' + emailKey;
    if (!pending.fromEmail) return 'Adresse de réponse inconnue.';

    var smtp = this._getSmtp();
    if (!smtp) return 'SMTP non configuré.';

    try {
      await smtp.sendMail({
        from: this.email,
        to: pending.fromEmail,
        subject: 'Re: ' + pending.subject,
        text: pending.draft,
        inReplyTo: pending.id,
      });

      log.info('Email sent to ' + pending.fromEmail + ': Re: ' + pending.subject);
      pending.approved = true;
      pendingDrafts.delete(emailKey);
      return '✅ Email envoyé à ' + pending.fromEmail + '\nSujet: Re: ' + pending.subject;
    } catch (err) {
      log.error('Send failed: ' + err.message);
      return '❌ Erreur d\'envoi: ' + err.message;
    }
  }

  /**
   * List pending emails that can be replied to.
   */
  listPending() {
    var items = [];
    for (var [key, val] of pendingDrafts) {
      items.push({
        key: key,
        from: val.from,
        fromEmail: val.fromEmail,
        subject: val.subject,
        hasDraft: !!val.draft,
      });
    }
    return items;
  }

  /**
   * Compose and send a new email (not a reply).
   */
  async composeAndSend(to, subject, body) {
    var smtp = this._getSmtp();
    if (!smtp) return 'SMTP non configuré. Vérifiez EMAIL_MONITOR_ADDRESS et EMAIL_MONITOR_PASSWORD dans .env';

    try {
      await smtp.sendMail({
        from: this.email,
        to: to,
        subject: subject,
        text: body,
      });
      log.info('Email composed and sent to ' + to + ': ' + subject);
      return '✅ Email envoyé à ' + to + '\nSujet: ' + subject;
    } catch (err) {
      log.error('Compose send failed: ' + err.message);
      return '❌ Erreur d\'envoi: ' + err.message;
    }
  }
}

// Singleton for access from AI tools
var _instance = null;
export function setEmailAgent(agent) { _instance = agent; }
export function getEmailAgent() { return _instance; }
