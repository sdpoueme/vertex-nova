/**
 * RAG Engine — Retrieval-Augmented Generation with local embeddings.
 *
 * Pipeline:
 *   1. EXTRACT: Chunk documents → generate embeddings via Ollama (nomic-embed-text)
 *   2. STORE: Persist vectors in Vectra (local file-based vector DB)
 *   3. RETRIEVE: Semantic search → top-K candidates
 *   4. RERANK: LLM-based reranking of candidates for relevance
 *   5. GENERATE: Inject context into the AI prompt
 *
 * Replaces the keyword-based searchKb() with semantic search.
 */
import { LocalIndex } from 'vectra';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { logger } from './log.js';

var log = logger('rag');

var OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
var EMBED_MODEL = process.env.RAG_EMBED_MODEL || 'nomic-embed-text';
var CHUNK_SIZE = 500;    // ~500 words per chunk
var CHUNK_OVERLAP = 50;  // 50 word overlap between chunks
var TOP_K = 10;          // Retrieve top 10 candidates
var RERANK_TOP = 5;      // Return top 5 after reranking

var vectorIndex = null;
var indexDir = null;
var indexReady = false;

// ═══════════════════════════════════════════════════════
// Embedding
// ═══════════════════════════════════════════════════════

/**
 * Generate embeddings via Ollama.
 */
async function embed(texts) {
  var input = Array.isArray(texts) ? texts : [texts];
  try {
    var res = await fetch(OLLAMA_URL + '/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: input }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error('Embed failed: ' + res.status);
    var data = await res.json();
    return data.embeddings;
  } catch (err) {
    log.error('Embedding error: ' + err.message);
    return null;
  }
}

/**
 * Generate a single embedding vector.
 */
async function embedSingle(text) {
  var result = await embed(text);
  return result ? result[0] : null;
}

// ═══════════════════════════════════════════════════════
// Chunking
// ═══════════════════════════════════════════════════════

/**
 * Split text into overlapping chunks.
 */
function chunkText(text, size, overlap) {
  size = size || CHUNK_SIZE;
  overlap = overlap || CHUNK_OVERLAP;
  var words = text.split(/\s+/);
  if (words.length <= size) return [text];

  var chunks = [];
  var i = 0;
  while (i < words.length) {
    var end = Math.min(i + size, words.length);
    chunks.push(words.slice(i, end).join(' '));
    i += size - overlap;
    if (i >= words.length) break;
  }
  return chunks;
}

/**
 * Extract readable text from HTML.
 */
function extractHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract text from a file based on extension.
 */
function extractFile(filePath) {
  var content = readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.html') || filePath.endsWith('.htm')) {
    return extractHtml(content);
  }
  if (filePath.endsWith('.json')) {
    try {
      var obj = JSON.parse(content);
      return JSON.stringify(obj, null, 2).slice(0, 10000);
    } catch { return content; }
  }
  // .md, .txt, etc — return as-is
  return content;
}

// ═══════════════════════════════════════════════════════
// Vector Index
// ═══════════════════════════════════════════════════════

/**
 * Initialize the vector index.
 */
export async function initRagIndex(projectDir) {
  indexDir = join(projectDir, '.rag-index');
  mkdirSync(indexDir, { recursive: true });

  vectorIndex = new LocalIndex(indexDir);

  if (!await vectorIndex.isIndexCreated()) {
    await vectorIndex.createIndex();
    log.info('RAG: created new vector index at ' + indexDir);
  } else {
    log.info('RAG: loaded existing vector index (' + (await getIndexStats()).totalItems + ' items)');
  }

  indexReady = true;
  return vectorIndex;
}

/**
 * Get index statistics.
 */
async function getIndexStats() {
  if (!vectorIndex) return { totalItems: 0 };
  try {
    var items = await vectorIndex.listItems();
    return { totalItems: items.length };
  } catch { return { totalItems: 0 }; }
}

// ═══════════════════════════════════════════════════════
// Indexing (Extract + Store)
// ═══════════════════════════════════════════════════════

/**
 * Index a single document (chunk + embed + store).
 */
export async function indexDocument(filePath, kbName, metadata) {
  if (!indexReady) return 0;

  var text = extractFile(filePath);
  if (text.length < 50) return 0;

  var chunks = chunkText(text);
  var indexed = 0;

  // Process one chunk at a time to avoid CPU spikes
  for (var i = 0; i < chunks.length; i++) {
    var embeddings = await embed(chunks[i]);
    if (!embeddings || !embeddings[0]) continue;

    try {
      await vectorIndex.insertItem({
        vector: embeddings[0],
        metadata: {
          kb: kbName,
          file: metadata?.file || filePath,
          chunk: i,
          text: chunks[i].slice(0, 2000),
          ...(metadata || {}),
        },
      });
      indexed++;
    } catch (err) {
      log.debug('Index insert error: ' + err.message);
    }

    // Throttle: 200ms pause between embeddings to keep CPU reasonable
    await new Promise(function(r) { setTimeout(r, 200); });
  }

  return indexed;
}

/**
 * Index an entire knowledge base directory.
 */
export async function indexKnowledgeBase(kbDir, kbName, fileTypes) {
  if (!indexReady) return 0;

  var files = [];
  function walk(dir) {
    try {
      var entries = readdirSync(dir, { withFileTypes: true });
      for (var e of entries) {
        if (e.name.startsWith('.')) continue;
        var full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (fileTypes.some(function(ft) { return e.name.endsWith(ft); })) files.push(full);
      }
    } catch {}
  }
  walk(kbDir);

  log.info('RAG: indexing ' + kbName + ' (' + files.length + ' files, throttled)...');
  var totalChunks = 0;

  for (var f of files) {
    var relPath = relative(kbDir, f);
    var chunks = await indexDocument(f, kbName, { file: relPath });
    totalChunks += chunks;
    // 500ms pause between files to keep CPU manageable
    await new Promise(function(r) { setTimeout(r, 500); });
  }

  log.info('RAG: indexed ' + kbName + ': ' + totalChunks + ' chunks from ' + files.length + ' files');
  return totalChunks;
}

/**
 * Clear all items for a specific KB (before re-indexing).
 */
export async function clearKbIndex(kbName) {
  if (!vectorIndex) return;
  try {
    var items = await vectorIndex.listItems();
    var toDelete = items.filter(function(item) { return item.metadata?.kb === kbName; });
    for (var item of toDelete) {
      await vectorIndex.deleteItem(item.id);
    }
    log.info('RAG: cleared ' + toDelete.length + ' items for KB ' + kbName);
  } catch (err) {
    log.warn('RAG clear error: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════
// Retrieval (Semantic Search)
// ═══════════════════════════════════════════════════════

/**
 * Semantic search — embed query, find nearest vectors.
 */
export async function retrieve(query, options) {
  if (!indexReady) return [];

  var topK = options?.topK || TOP_K;
  var kbFilter = options?.kb || null;

  var queryVector = await embedSingle(query);
  if (!queryVector) return [];

  try {
    var results = await vectorIndex.queryItems(queryVector, topK * 2); // Over-fetch for filtering

    // Filter by KB if specified
    if (kbFilter) {
      results = results.filter(function(r) { return r.item.metadata?.kb === kbFilter; });
    }

    return results.slice(0, topK).map(function(r) {
      return {
        score: r.score,
        text: r.item.metadata?.text || '',
        kb: r.item.metadata?.kb || '',
        file: r.item.metadata?.file || '',
        chunk: r.item.metadata?.chunk || 0,
      };
    });
  } catch (err) {
    log.error('RAG retrieve error: ' + err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════
// Reranking (LLM-based)
// ═══════════════════════════════════════════════════════

/**
 * Rerank retrieved results using Ollama for relevance scoring.
 */
export async function rerank(query, results, topN) {
  topN = topN || RERANK_TOP;
  if (results.length <= topN) return results;

  // Build reranking prompt
  var candidates = results.map(function(r, i) {
    return 'Document ' + (i + 1) + ':\n' + r.text.slice(0, 300);
  }).join('\n\n');

  var prompt = 'Given the query: "' + query + '"\n\n' +
    'Rank these documents by relevance (most relevant first). Return ONLY the document numbers in order, comma-separated.\n\n' +
    candidates + '\n\nRanking (numbers only):';

  try {
    var res = await fetch(OLLAMA_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'qwen3:8b',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0, num_predict: 50 },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return results.slice(0, topN);
    var data = await res.json();
    var ranking = (data.message?.content || '').match(/\d+/g);

    if (!ranking || ranking.length === 0) return results.slice(0, topN);

    // Reorder results based on LLM ranking
    var reranked = [];
    for (var num of ranking) {
      var idx = parseInt(num) - 1;
      if (idx >= 0 && idx < results.length && !reranked.includes(results[idx])) {
        reranked.push(results[idx]);
      }
    }

    // Add any results not mentioned by the LLM
    for (var r of results) {
      if (!reranked.includes(r)) reranked.push(r);
    }

    return reranked.slice(0, topN);
  } catch (err) {
    log.debug('Rerank failed: ' + err.message + ', using vector scores');
    return results.slice(0, topN);
  }
}

// ═══════════════════════════════════════════════════════
// Full RAG Pipeline (Retrieve + Rerank)
// ═══════════════════════════════════════════════════════

/**
 * Full RAG search: retrieve → rerank → return context.
 */
export async function ragSearch(query, options) {
  var candidates = await retrieve(query, { topK: TOP_K, kb: options?.kb });
  if (candidates.length === 0) return [];

  var reranked = await rerank(query, candidates, options?.topN || RERANK_TOP);
  return reranked;
}

/**
 * Build a context string from RAG results for injection into prompts.
 */
export function buildRagContext(results) {
  if (!results || results.length === 0) return '';

  var context = results.map(function(r, i) {
    return '[Source: ' + r.kb + '/' + r.file + ']\n' + r.text;
  }).join('\n\n---\n\n');

  return '<knowledge_context>\n' + context + '\n</knowledge_context>';
}

// ═══════════════════════════════════════════════════════
// Exports for status/management
// ═══════════════════════════════════════════════════════

export async function getRagStats() {
  var stats = await getIndexStats();
  return {
    ready: indexReady,
    indexDir: indexDir,
    totalItems: stats.totalItems,
    embedModel: EMBED_MODEL,
  };
}
