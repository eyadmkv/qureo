import { normalizeText, savePublicPage, searchKnowledge } from './db.js';

const INDEX_URL = 'https://miacademyeg.dpdns.org/learn/qureo-solutions.html';
const HOST = 'miacademyeg.dpdns.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';

function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function htmlToText(html) {
  let source = String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '\n');
  const codeBlocks = [];
  source = source.replace(/<(pre|code)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, inner) => {
    const marker = `QUREO_CODE_BLOCK_${codeBlocks.length}_TOKEN`;
    codeBlocks.push(decodeEntities(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')));
    return `\n${marker}\n`;
  });
  let text = decodeEntities(source
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[\t\u00a0 ]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  codeBlocks.forEach((block, index) => {
    text = text.replace(`QUREO_CODE_BLOCK_${index}_TOKEN`, block.trim());
  });
  return text;
}

function titleFrom(html) {
  return decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || 'QUREO guide').replace(/<[^>]+>/g, '').trim();
}

async function fetchPage(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== HOST) throw new Error('Blocked external guide URL.');
  const response = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const html = await response.text();
  return { title: titleFrom(html), body: htmlToText(html), html };
}

export async function syncPublicGuides({ onProgress = () => {} } = {}) {
  const index = await fetchPage(INDEX_URL);
  savePublicPage({ url: INDEX_URL, source: 'MI Academy public index', title: index.title, body: index.body });
  const links = new Set();
  const regex = /href\s*=\s*(["'])([^"']+\.html(?:#[^"']*)?)\1/gi;
  for (const match of index.html.matchAll(regex)) {
    let url;
    try { url = new URL(match[2], INDEX_URL); } catch { continue; }
    if (url.hostname !== HOST || !/^\/learn\/qureo-(?:sec1|bac2)-ch\d+\.html$/i.test(url.pathname)) continue;
    links.add(url.href);
  }
  const urls = [...links];
  let saved = 1;
  let failed = 0;
  onProgress({ current: 0, total: urls.length, message: `Found ${urls.length} public chapter pages.` });
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const page = await fetchPage(url);
      savePublicPage({ url, source: 'MI Academy public QUREO guide', title: page.title, body: page.body });
      saved++;
    } catch {
      failed++;
    }
    onProgress({ current: i + 1, total: urls.length, message: `Fetched ${i + 1}/${urls.length}.` });
    await new Promise(resolve => setTimeout(resolve, 450));
  }
  return { indexUrl: INDEX_URL, discovered: urls.length, saved, failed };
}

function makeExcerpts(body, query, max = 4) {
  const terms = normalizeText(query).split(/\s+/).filter(x => x.length > 1);
  const blocks = body.split(/\n{1,2}/).map(x => x.trim()).filter(Boolean);
  const scored = blocks.map((block, index) => ({
    block,
    index,
    score: terms.reduce((sum, term) => sum + (normalizeText(block).includes(term) ? 1 : 0), 0)
  })).filter(x => x.score > 0).sort((a,b) => b.score-a.score || a.index-b.index);
  return scored.slice(0, max).map(x => x.block.slice(0, 1200));
}

export function searchAnswers(query, limit = 8) {
  const result = searchKnowledge(query, limit);
  return {
    pages: result.pages.map(page => ({ ...page, excerpts: makeExcerpts(page.body, query) })),
    questions: result.questions,
    answers: result.answers
  };
}

export function answerIndexUrl() { return INDEX_URL; }
