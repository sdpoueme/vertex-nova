#!/usr/bin/env node
/**
 * One-time Alexa login — run this once to establish cookie auto-refresh.
 * Usage: npm run alexa:login
 *
 * Opens a proxy on http://127.0.0.1:3579 — log in to Amazon in your browser.
 * After login, formerRegistrationData is saved and auto-refresh takes over.
 */
import { join } from 'node:path';
import { initialLogin } from '../src/alexa-cookie-refresh.js';

var vaultPath = join(process.cwd(), 'vault');
console.log('\n🔐 Alexa Cookie Setup');
console.log('━━━━━━━━━━━━━━━━━━━━━━');
console.log('1. A proxy will start on http://127.0.0.1:3579');
console.log('2. Open that URL in your browser');
console.log('3. Sign in to your Amazon account');
console.log('4. After login, cookies will be saved automatically\n');

var result = await initialLogin(vaultPath, 3579);
if (result) {
  console.log('\n✅ Login successful! Cookies saved.');
  console.log('   AT_MAIN and UBID_MAIN are now stored for auto-refresh.');
  console.log('   Restart Vertex Nova: npm start\n');
  process.exit(0);
} else {
  console.log('\n❌ Login failed or timed out. Check the logs above.\n');
  process.exit(1);
}
