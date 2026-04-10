import { generateTtsUrl, startTtsServer } from '../src/tts-server.js';
import { readFileSync } from 'fs';

const server = startTtsServer(3004);
await new Promise(r => setTimeout(r, 500));

const message = "Bonjour! En ce moment, on est en train de construire un assistant maison intelligent. " +
  "Il peut parler à travers les haut-parleurs Sonos, recevoir des messages par Telegram, WhatsApp et Alexa, " +
  "et gérer toute la maison. C'est vraiment cool!";

const url = await generateTtsUrl(message, {
  piperPath: process.env.TTS_PATH || 'piper',
  frModel: process.env.TTS_FR_MODEL || '',
  enModel: process.env.TTS_MODEL || '',
  port: 3004,
});

console.log('TTS URL:', url);

const tokens = JSON.parse(readFileSync('.sonos-tokens.json', 'utf8'));
const res = await fetch('https://api.ws.sonos.com/control/api/v1/players/RINCON_F0F6C19DDD0C01400/audioClip', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + tokens.access_token,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    streamUrl: url,
    name: 'Home Assistant',
    appId: 'com.home.assistant',
    volume: 40,
    clipType: 'CUSTOM',
  }),
});

console.log('Sonos:', res.status);
setTimeout(() => { server.close(); process.exit(0); }, 30000);
