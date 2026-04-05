/**
 * Sonos token refresh — keeps OAuth tokens fresh so TTS never fails.
 * Called on agent startup and every 12 hours.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../log.js';

var log = logger('sonos-refresh');
var TOKEN_URL = 'https://api.sonos.com/login/v3/oauth/access';

export async function refreshSonosTokens(config) {
  var tokenFile = resolve(config.projectDir, '.sonos-tokens.json');
  try {
    var tokens = JSON.parse(readFileSync(tokenFile, 'utf8'));
    if (!tokens.refresh_token) {
      log.error('No refresh token. Run: node scripts/sonos-auth.js');
      return false;
    }

    // Skip if token is still fresh (less than 50% of TTL elapsed)
    var elapsed = (Date.now() - tokens.obtained_at) / 1000;
    if (elapsed < (tokens.expires_in || 86400) * 0.5) {
      log.debug('Token still fresh (' + Math.round(elapsed) + 's elapsed), skipping refresh');
      return true;
    }

    var basicAuth = Buffer.from(config.sonosClientId + ':' + config.sonosClientSecret).toString('base64');
    var res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + basicAuth,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
      }),
    });

    if (!res.ok) {
      var err = await res.text();
      log.error('Refresh failed: ' + res.status + ' ' + err);
      return false;
    }

    var data = await res.json();
    var newTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokens.refresh_token,
      token_type: data.token_type,
      expires_in: data.expires_in,
      obtained_at: Date.now(),
    };
    writeFileSync(tokenFile, JSON.stringify(newTokens, null, 2));
    log.info('Tokens refreshed (expires in ' + data.expires_in + 's)');
    return true;
  } catch (err) {
    log.error('Refresh error: ' + err.message);
    return false;
  }
}
