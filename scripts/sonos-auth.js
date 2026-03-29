/**
 * Sonos OAuth 2.0 Authorization Flow
 * 
 * Run this once to authorize your Sonos household:
 *   node scripts/sonos-auth.js
 *
 * It will:
 *   1. Open your browser to the Sonos login page
 *   2. You log in and authorize the integration
 *   3. Sonos redirects back to localhost:3003/callback with an auth code
 *   4. We exchange the code for access + refresh tokens
 *   5. Tokens are saved to .sonos-tokens.json
 */
import { createServer } from 'node:http';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exec } from 'node:child_process';

const CLIENT_ID = process.env.SONOS_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SONOS_CLIENT_SECRET || '';
const REDIRECT_URI = 'http://localhost:3003/callback';
const TOKEN_FILE = resolve(import.meta.dirname, '..', '.sonos-tokens.json');

const AUTH_URL = 'https://api.sonos.com/login/v3/oauth';
const TOKEN_URL = 'https://api.sonos.com/login/v3/oauth/access';

// Build the authorization URL
const authParams = new URLSearchParams({
  client_id: CLIENT_ID,
  response_type: 'code',
  state: 'home-assistant',
  scope: 'playback-control-all',
  redirect_uri: REDIRECT_URI,
});

const authUrl = `${AUTH_URL}?${authParams}`;

console.log('\n🔊 Sonos OAuth Authorization\n');
console.log('Opening your browser to authorize with Sonos...\n');
console.log(`If the browser doesn't open, visit:\n${authUrl}\n`);

// Open browser
const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
exec(`${openCmd} "${authUrl}"`);

// Start local server to receive the callback
const server = createServer(async (req, res) => {
  if (!req.url?.startsWith('/callback')) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const url = new URL(req.url, 'http://localhost:3003');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
    console.error(`\n❌ Authorization failed: ${error}`);
    server.close();
    process.exit(1);
    return;
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>Missing authorization code</h1>');
    return;
  }

  console.log('✓ Received authorization code, exchanging for tokens...');

  try {
    // Exchange code for tokens
    const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Token exchange failed: ${tokenRes.status} ${err}`);
    }

    const tokens = await tokenRes.json();

    // Save tokens
    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
      obtained_at: Date.now(),
    };

    writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));

    console.log(`✓ Tokens saved to ${TOKEN_FILE}`);
    console.log(`  Access token expires in ${tokens.expires_in}s`);
    console.log(`  Refresh token saved for automatic renewal\n`);
    console.log('🎉 Sonos authorization complete! You can close this browser tab.\n');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html><body style="font-family: system-ui; text-align: center; padding: 60px;">
        <h1>✅ Sonos Authorized</h1>
        <p>Tokens saved. You can close this tab and return to the terminal.</p>
      </body></html>
    `);
  } catch (err) {
    console.error(`\n❌ ${err.message}`);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h1>Token exchange failed</h1><p>${err.message}</p>`);
  }

  server.close();
  setTimeout(() => process.exit(0), 500);
});

server.listen(3003, () => {
  console.log('Waiting for Sonos callback on http://localhost:3003/callback ...\n');
});
