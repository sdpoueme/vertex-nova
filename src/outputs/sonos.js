/**
 * Sonos Output — Official Sonos Control API (cloud).
 *
 * Uses api.ws.sonos.com/control/api/v1 with OAuth 2.0.
 * Supports: playback control, volume, audioClip (TTS/notifications),
 * favorites, groups, and player discovery.
 *
 * Requires:
 *   SONOS_CLIENT_ID     - From developer.sonos.com
 *   SONOS_CLIENT_SECRET - From developer.sonos.com
 *   .sonos-tokens.json  - Created by scripts/sonos-auth.js
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../log.js';

const log = logger('sonos');

const API_BASE = 'https://api.ws.sonos.com/control/api/v1';
const TOKEN_URL = 'https://api.sonos.com/login/v3/oauth/access';

export class SonosOutput {
  constructor(config) {
    this.clientId = config.sonosClientId || '';
    this.clientSecret = config.sonosClientSecret || '';
    this.tokenFile = resolve(config.projectDir, '.sonos-tokens.json');
    this.defaultRoom = config.sonosDefaultRoom || null;
    this.ttsVolume = config.sonosTtsVolume || 30;

    this._tokens = null;
    this._household = null;
    this._players = null;
    this._groups = null;
  }

  // --- Token Management ---

  _loadTokens() {
    if (this._tokens) return this._tokens;
    try {
      this._tokens = JSON.parse(readFileSync(this.tokenFile, 'utf8'));
      return this._tokens;
    } catch {
      log.error('No Sonos tokens found. Run: node scripts/sonos-auth.js');
      return null;
    }
  }

  _saveTokens(tokens) {
    this._tokens = tokens;
    writeFileSync(this.tokenFile, JSON.stringify(tokens, null, 2));
  }

  async _refreshTokens() {
    const tokens = this._loadTokens();
    if (!tokens?.refresh_token) {
      log.error('No refresh token available. Re-run: node scripts/sonos-auth.js');
      return null;
    }

    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        log.error(`Token refresh failed: ${res.status} ${err}`);
        return null;
      }

      const newTokens = await res.json();
      const tokenData = {
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token || tokens.refresh_token,
        token_type: newTokens.token_type,
        expires_in: newTokens.expires_in,
        obtained_at: Date.now(),
      };

      this._saveTokens(tokenData);
      log.info('Sonos tokens refreshed');
      return tokenData;
    } catch (err) {
      log.error('Token refresh error:', err.message);
      return null;
    }
  }

  _isTokenExpired() {
    const tokens = this._loadTokens();
    if (!tokens) return true;
    const elapsed = (Date.now() - tokens.obtained_at) / 1000;
    return elapsed >= (tokens.expires_in - 60); // refresh 60s before expiry
  }

  async _getAccessToken() {
    if (this._isTokenExpired()) {
      const refreshed = await this._refreshTokens();
      if (!refreshed) return null;
    }
    return this._loadTokens()?.access_token;
  }

  // --- API Calls ---

  async _api(method, path, body) {
    const token = await this._getAccessToken();
    if (!token) return null;

    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    };
    if (body) opts.body = JSON.stringify(body);

    try {
      const res = await fetch(`${API_BASE}${path}`, opts);

      if (res.status === 401) {
        // Token expired, try refresh once
        const refreshed = await this._refreshTokens();
        if (!refreshed) return null;
        opts.headers['Authorization'] = `Bearer ${refreshed.access_token}`;
        const retry = await fetch(`${API_BASE}${path}`, opts);
        if (!retry.ok) {
          log.error(`Sonos API ${method} ${path}: ${retry.status}`);
          return null;
        }
        return retry.status === 204 ? {} : await retry.json();
      }

      if (!res.ok) {
        const err = await res.text();
        log.error(`Sonos API ${method} ${path}: ${res.status} ${err}`);
        return null;
      }

      return res.status === 204 ? {} : await res.json();
    } catch (err) {
      log.error(`Sonos API error: ${err.message}`);
      return null;
    }
  }

  // --- Discovery ---

  async getHouseholds() {
    const data = await this._api('GET', '/households');
    return data?.households || [];
  }

  async _ensureHousehold() {
    if (this._household) return this._household;
    const households = await this.getHouseholds();
    if (households.length === 0) {
      log.error('No Sonos households found');
      return null;
    }
    this._household = households[0].id;
    log.info(`Sonos household: ${this._household}`);
    return this._household;
  }

  async getGroups() {
    const hh = await this._ensureHousehold();
    if (!hh) return { groups: [], players: [] };
    const data = await this._api('GET', `/households/${hh}/groups`);
    if (data) {
      this._groups = data.groups || [];
      this._players = data.players || [];
    }
    return { groups: this._groups || [], players: this._players || [] };
  }

  async _findPlayer(roomName) {
    const { players } = await this.getGroups();
    const name = (roomName || this.defaultRoom || '').toLowerCase();
    return players.find(p => p.name.toLowerCase() === name);
  }

  async _findGroup(roomName) {
    const { groups, players } = await this.getGroups();
    const name = (roomName || this.defaultRoom || '').toLowerCase();
    // Find the player first, then find which group it belongs to
    const player = players.find(p => p.name.toLowerCase() === name);
    if (!player) return null;
    return groups.find(g => g.playerIds?.includes(player.id) || g.coordinatorId === player.id);
  }

  // --- Audio Clip (TTS / Notifications) ---

  /**
   * Play an audio clip on a specific player. This overlays on top of
   * whatever is currently playing and restores afterward.
   *
   * @param {string} audioUrl - Public URL of the audio file (mp3/wav)
   * @param {string} [roomName] - Player name
   * @param {object} [opts] - { volume, name, appId, clipType }
   */
  async loadAudioClip(audioUrl, roomName, opts = {}) {
    const player = await this._findPlayer(roomName);
    if (!player) {
      log.error(`Player not found: ${roomName || this.defaultRoom}`);
      return null;
    }

    const body = {
      streamUrl: audioUrl,
      name: opts.name || 'Home Assistant',
      appId: opts.appId || 'com.home.assistant',
      volume: opts.volume || this.ttsVolume,
      clipType: opts.clipType || 'CUSTOM',
    };

    const result = await this._api('POST', `/players/${player.id}/audioClip`, body);
    if (result) {
      log.info(`Audio clip → ${player.name}`);
    }
    return result;
  }

  /**
   * Speak text on a Sonos speaker.
   * Uses local Piper TTS → serves MP3 on LAN → Sonos fetches it.
   *
   * @param {string} text - Text to speak
   * @param {string} [roomName] - Player name
   */
  async speak(text, roomName) {
    if (!this._ttsOpts) {
      log.error('TTS not configured. Set piperPath and models in config.');
      return null;
    }

    try {
      const { generateTtsUrl } = await import('../tts-server.js');
      const audioUrl = await generateTtsUrl(text, this._ttsOpts);
      log.debug(`TTS generated: ${audioUrl}`);
      return this.loadAudioClip(audioUrl, roomName, {
        name: 'Home Assistant TTS',
        clipType: 'CUSTOM',
      });
    } catch (err) {
      log.error('TTS failed:', err.message);
      return null;
    }
  }

  /**
   * Configure TTS options. Called during initialization.
   */
  configureTts(opts) {
    this._ttsOpts = opts;
  }

  /**
   * Speak on all players.
   */
  async speakAll(text) {
    const { players } = await this.getGroups();
    const results = [];
    for (const player of players) {
      results.push(this.speak(text, player.name));
    }
    return Promise.allSettled(results);
  }

  // --- Playback Control ---

  async play(roomName) {
    const group = await this._findGroup(roomName);
    if (!group) return log.error(`Group not found for: ${roomName}`);
    return this._api('POST', `/groups/${group.id}/playback/play`);
  }

  async pause(roomName) {
    const group = await this._findGroup(roomName);
    if (!group) return log.error(`Group not found for: ${roomName}`);
    return this._api('POST', `/groups/${group.id}/playback/pause`);
  }

  async skipToNext(roomName) {
    const group = await this._findGroup(roomName);
    if (!group) return log.error(`Group not found for: ${roomName}`);
    return this._api('POST', `/groups/${group.id}/playback/skipToNextTrack`);
  }

  async skipToPrevious(roomName) {
    const group = await this._findGroup(roomName);
    if (!group) return log.error(`Group not found for: ${roomName}`);
    return this._api('POST', `/groups/${group.id}/playback/skipToPreviousTrack`);
  }

  // --- Volume ---

  async setVolume(level, roomName) {
    const player = await this._findPlayer(roomName);
    if (!player) return log.error(`Player not found: ${roomName}`);
    return this._api('POST', `/players/${player.id}/playerVolume`, { volume: level });
  }

  async setGroupVolume(level, roomName) {
    const group = await this._findGroup(roomName);
    if (!group) return log.error(`Group not found for: ${roomName}`);
    return this._api('POST', `/groups/${group.id}/groupVolume`, { volume: level });
  }

  // --- Favorites ---

  async getFavorites() {
    const hh = await this._ensureHousehold();
    if (!hh) return [];
    const data = await this._api('GET', `/households/${hh}/favorites`);
    return data?.items || [];
  }

  async playFavorite(favoriteId, roomName) {
    const group = await this._findGroup(roomName);
    if (!group) return log.error(`Group not found for: ${roomName}`);
    return this._api('POST', `/groups/${group.id}/favorites`, {
      favoriteId,
      playOnCompletion: true,
    });
  }

  // --- Info ---

  async listRooms() {
    const { groups, players } = await this.getGroups();
    return players.map(p => ({
      id: p.id,
      name: p.name,
      model: p.model || 'Unknown',
      capabilities: p.capabilities || [],
      group: groups.find(g => g.playerIds?.includes(p.id))?.name || 'ungrouped',
    }));
  }

  async getPlaybackState(roomName) {
    const group = await this._findGroup(roomName);
    if (!group) return null;
    return this._api('GET', `/groups/${group.id}/playback`);
  }
}
