#!/usr/bin/env node
/**
 * KB URL Worker — runs in a child process to fetch web pages without blocking the main event loop.
 * 
 * Usage: node kb-url-worker.js <outputDir> <url1> <url2> ...
 * Writes fetched pages as .md files to outputDir.
 * Exits with code 0 on success, 1 on failure.
 */
var MAX_PAGES_PER_SITE = 50;
var FETCH_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; VertexNova/1.0)' };

var { writeFileSync, mkdirSync } = require('node:fs');
var { join } = require('node:path');

async function fetchPage(url) {
  try {
    var res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(15000), redirect: 'follow' });
    if (!res.ok) return null;
    return res.text();
  } catch { return null; }
}

function extractHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function discoverSitePages(baseUrl) {
  var origin = new URL(baseUrl).origin;
  var pages = new Set();
  pages.add(baseUrl);

  var sitemapUrls = [origin + '/sitemap.xml', origin + '/sitemap_index.xml'];
  for (var smUrl of sitemapUrls) {
    try {
      var smHtml = await fetchPage(smUrl);
      if (!smHtml) continue;
      var subSitemaps = smHtml.match(/<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>/g) || [];
      var locsToProcess = [smHtml];
      for (var sub of subSitemaps) {
        var subLoc = (sub.match(/<loc>([\s\S]*?)<\/loc>/) || [])[1]?.trim();
        if (subLoc) { try { var sc = await fetchPage(subLoc); if (sc) locsToProcess.push(sc); } catch {} }
      }
      for (var content of locsToProcess) {
        var locRegex = /<url>[\s\S]*?<loc>([\s\S]*?)<\/loc>/g;
        var m;
        while ((m = locRegex.exec(content)) !== null && pages.size < MAX_PAGES_PER_SITE) {
          var loc = m[1].trim().replace(/&amp;/g, '&');
          if (loc.startsWith(origin)) pages.add(loc);
        }
      }
      if (pages.size > 1) return Array.from(pages);
    } catch {}
  }

  // Fallback: link extraction
  try {
    var html = await fetchPage(baseUrl);
    if (html) {
      var linkRegex = /href="(\/[^"]*|https?:\/\/[^"]*?)"/g;
      var lm;
      while ((lm = linkRegex.exec(html)) !== null && pages.size < MAX_PAGES_PER_SITE) {
        var href = lm[1];
        if (href.startsWith('/')) href = origin + href;
        if (href.startsWith(origin) && !href.match(/\.(jpg|png|gif|css|js|svg|pdf|zip|ico)(\?|$)/i)) {
          pages.add(href.split('#')[0].split('?')[0]);
        }
      }
    }
  } catch {}

  return Array.from(pages);
}

async function main() {
  var args = process.argv.slice(2);
  var outputDir = args[0];
  var urls = args.slice(1);

  if (!outputDir || urls.length === 0) {
    console.error('Usage: node kb-url-worker.js <outputDir> <url1> [url2] ...');
    process.exit(1);
  }

  mkdirSync(outputDir, { recursive: true });

  // Discover all pages
  var allPages = new Set();
  for (var baseUrl of urls) {
    var discovered = await discoverSitePages(baseUrl);
    for (var p of discovered) allPages.add(p);
    console.log('Discovered ' + discovered.length + ' pages from ' + baseUrl);
  }

  console.log('Total: ' + allPages.size + ' pages from ' + urls.length + ' site(s)');

  // Fetch and save
  var fetched = 0;
  for (var url of allPages) {
    try {
      var html = await fetchPage(url);
      if (!html) continue;
      var text = extractHtml(html);
      if (text.length < 50) continue;
      var titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      var title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : url;
      var safeName = url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 80);
      var content = '# ' + title + '\n\nSource: ' + url + '\nFetched: ' + new Date().toISOString() + '\n\n' + text;
      writeFileSync(join(outputDir, safeName + '.md'), content);
      fetched++;
    } catch {}
  }

  console.log('Saved ' + fetched + '/' + allPages.size + ' pages');
  process.exit(0);
}

main().catch(function(err) { console.error(err.message); process.exit(1); });
