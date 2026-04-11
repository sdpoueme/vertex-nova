/**
 * Async Thinker Agent — reviews responses in the background.
 *
 * After the fast agent responds (think: false), the thinker runs
 * asynchronously with thinking enabled to:
 *   1. Evaluate if the response was good
 *   2. Identify missed context or better tool choices
 *   3. Save learnings to memory for future improvement
 *
 * This never blocks the user — they get the fast response immediately.
 * The thinker runs in the background and writes to vault/memories/thinker-learnings.md
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './home-config.js';
import { logger } from './log.js';

var log = logger('thinker');
var OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
var OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';
var pendingReviews = [];
var isProcessing = false;
var MAX_QUEUE = 10;

/**
 * Queue a response for async review.
 * Called after the fast agent responds — never blocks.
 */
export function queueReview(userMessage, agentResponse, agentName) {
  // Skip trivial interactions
  if (!userMessage || !agentResponse) return;
  if (agentResponse.length < 30) return;
  if (userMessage.length < 10) return;
  // Skip if response was an error
  if (agentResponse.includes('difficultés techniques') || agentResponse.includes('Trop d')) return;

  pendingReviews.push({
    userMessage: userMessage.slice(0, 300),
    agentResponse: agentResponse.slice(0, 500),
    agentName: agentName || 'general',
    timestamp: Date.now(),
  });

  if (pendingReviews.length > MAX_QUEUE) pendingReviews.shift();

  // Start processing if not already running
  if (!isProcessing) processQueue();
}

async function processQueue() {
  if (pendingReviews.length === 0) { isProcessing = false; return; }
  isProcessing = true;

  var review = pendingReviews.shift();
  try {
    await thinkAbout(review);
  } catch (err) {
    log.debug('Thinker error: ' + err.message);
  }

  // Process next after a delay (don't hog Ollama)
  setTimeout(function() { processQueue(); }, 5000);
}

async function thinkAbout(review) {
  var prompt = 'Évalue cette interaction et identifie des améliorations:\n\n' +
    'Question: ' + review.userMessage + '\n' +
    'Réponse (' + review.agentName + '): ' + review.agentResponse + '\n\n' +
    'En 1-2 phrases:\n' +
    '1. La réponse était-elle pertinente et complète?\n' +
    '2. Quel outil ou approche aurait donné un meilleur résultat?\n' +
    'Si la réponse était bonne, dis "OK".';

  try {
    var res = await fetch(OLLAMA_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        think: true, // This is where thinking happens — async, no user waiting
      }),
    });

    if (!res.ok) return;
    var data = await res.json();
    var thinking = data.message?.thinking || '';
    var response = data.message?.content || '';

    // If the thinker found something useful, save it
    if (response && !response.trim().startsWith('OK') && response.length > 20) {
      saveLearning(review, response, thinking);
    }
  } catch {}
}

function saveLearning(review, evaluation, thinking) {
  try {
    var vaultPath = resolve(config.vaultPath || join(config.projectDir, 'vault'));
    var memDir = join(vaultPath, 'memories');
    mkdirSync(memDir, { recursive: true });

    var filePath = join(memDir, 'thinker-learnings.md');
    var date = new Date().toISOString().slice(0, 16);
    var entry = '\n## ' + date + ' [' + review.agentName + ']\n' +
      'Q: ' + review.userMessage.slice(0, 150) + '\n' +
      'Évaluation: ' + evaluation.slice(0, 300) + '\n';

    // Keep file under 5000 chars
    var existing = '';
    if (existsSync(filePath)) {
      existing = readFileSync(filePath, 'utf8');
      if (existing.length > 5000) existing = '...\n' + existing.slice(-4000);
    } else {
      existing = '# Apprentissages du Thinker\n\nÉvaluations asynchrones des réponses de l\'agent.\n';
    }

    writeFileSync(filePath, existing + entry);
    log.info('Thinker learning saved for: ' + review.userMessage.slice(0, 50));
  } catch {}
}
