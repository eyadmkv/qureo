import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';
import { savePublicPage } from './db.js';

export const PYTHON_ANSWER_INDEX_URL = 'https://answers.studentplatformeg.online/qureo-python/';
const HOST = 'answers.studentplatformeg.online';
const OUTPUT_PATH = path.join(DATA_DIR, 'python_short_ar_answer_guide.json');

export function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;|&#160;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_match, digits) => {
      const codePoint = Number(digits);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : _match;
    })
    .replace(/&#x([\da-f]+);/giu, (_match, digits) => {
      const codePoint = Number.parseInt(digits, 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : _match;
    });
}

export function htmlToText(html) {
  let source = String(html ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '\n')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, '\n')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, '\n');

  const codeBlocks = [];
  source = source.replace(/<(pre|code)\b[^>]*>([\s\S]*?)<\/\1>/giu, (_match, _tag, inner) => {
    const marker = `QUREO_PYTHON_CODE_${codeBlocks.length}_TOKEN`;
    codeBlocks.push(decodeHtmlEntities(inner.replace(/<br\s*\/?>/giu, '\n').replace(/<[^>]+>/gu, '')));
    return `\n${marker}\n`;
  });

  let text = decodeHtmlEntities(source
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|tr|blockquote|button)>/giu, '\n')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<[^>]+>/gu, ''))
    .replace(/[\t\u00a0 ]+/gu, ' ')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  codeBlocks.forEach((block, index) => {
    text = text.replace(`QUREO_PYTHON_CODE_${index}_TOKEN`, block.trim());
  });
  return text;
}

function titleFrom(html) {
  const match = String(html ?? '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu) ||
    String(html ?? '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu);
  return decodeHtmlEntities((match?.[1] ?? 'QUREO Python answer guide').replace(/<[^>]+>/gu, '')).trim();
}

function hrefsFrom(html, baseUrl) {
  const links = new Set();
  for (const match of String(html ?? '').matchAll(/\bhref\s*=\s*(["'])([^"']+)\1/giu)) {
    try {
      const url = new URL(match[2], baseUrl);
      if (url.protocol === 'https:' && url.hostname === HOST) {
        url.hash = '';
        url.search = '';
        links.add(url.href.endsWith('/') ? url.href : url.href + '/');
      }
    } catch {}
  }
  return [...links];
}

export function extractPythonLevelUrls(html, baseUrl = PYTHON_ANSWER_INDEX_URL) {
  return hrefsFrom(html, baseUrl)
    .filter(value => /^\/qureo-python\/l\d{2}\/$/u.test(new URL(value).pathname))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export function extractPythonLessonUrls(html, levelUrl) {
  const levelPath = new URL(levelUrl).pathname.replace(/\/$/u, '');
  if (!/^\/qureo-python\/l\d{2}$/u.test(levelPath)) return [];
  const prefix = levelPath + '/';
  return hrefsFrom(html, levelUrl)
    .filter(value => {
      const pathname = new URL(value).pathname;
      if (!pathname.startsWith(prefix)) return false;
      const rest = pathname.slice(prefix.length).split('/').filter(Boolean);
      return rest.length === 1;
    })
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export function extractPythonAnswerPairs(body) {
  const lines = String(body ?? '').split(/\r?\n/u).map(line => line.trim());
  const records = [];

  for (let index = 0; index < lines.length; index++) {
    const marker = lines[index].match(/^السؤال\s*(\d+)\s*[:：]?$/u);
    if (!marker) continue;

    let questionIndex = index + 1;
    while (questionIndex < lines.length && !lines[questionIndex]) questionIndex++;
    const question = (lines[questionIndex] ?? '').replace(/^#+\s*/u, '').trim();
    if (!question) continue;

    const answerLines = [];
    for (let cursor = questionIndex + 1; cursor < lines.length; cursor++) {
      const line = lines[cursor];
      if (/^السؤال\s*\d+\s*[:：]?$/u.test(line) ||
          /^نسخ\s+(?:كل\s+)?الإجابات?/u.test(line) ||
          /^←\s*السابق/u.test(line) ||
          /^التالي\s*:/u.test(line) ||
          /^Made with intention\.?$/iu.test(line) ||
          /^إعلان/u.test(line)) break;
      if (line) answerLines.push(line);
    }

    const answer = answerLines.join('\n').trim();
    if (answer) records.push({ question_number: Number(marker[1]), question, answer });
  }

  return records;
}

async function fetchPage(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== HOST || !parsed.pathname.startsWith('/qureo-python/')) {
    throw new Error('Blocked URL outside the public QUREO Python answer guide.');
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'
    },
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

  const finalUrl = new URL(response.url || url);
  if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== HOST) {
    throw new Error('The answer guide redirected outside its own HTTPS host.');
  }

  const html = await response.text();
  return { url: finalUrl.href, html, title: titleFrom(html), body: htmlToText(html) };
}

function wait(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

export async function syncPythonAnswerGuide({ delayMs = 300, onProgress = () => {} } = {}) {
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5000) {
    throw new Error('Request delay must be an integer between 0 and 5000 milliseconds.');
  }

  const index = await fetchPage(PYTHON_ANSWER_INDEX_URL);
  savePublicPage({
    url: index.url,
    source: 'StudentPlatformEG public QUREO Python answer guide',
    title: index.title,
    body: index.body
  });

  const levelUrls = extractPythonLevelUrls(index.html, index.url);
  if (!levelUrls.length) {
    throw new Error('The public answer index did not expose any Python level links.');
  }

  const levels = [];
  const answers = [];
  const countMismatches = [];
  const failedPages = [];
  let lessonsFound = 0;
  let lessonsFetched = 0;
  let requests = 0;

  for (const [levelIndex, levelUrl] of levelUrls.entries()) {
    await wait(requests++ === 0 ? 0 : delayMs);
    let levelPage;
    try {
      levelPage = await fetchPage(levelUrl);
    } catch (error) {
      failedPages.push({ url: levelUrl, error: error.message });
      onProgress({ message: `Level ${levelIndex + 1}/${levelUrls.length} failed: ${error.message}` });
      continue;
    }

    savePublicPage({
      url: levelPage.url,
      source: 'StudentPlatformEG public QUREO Python answer guide',
      title: levelPage.title,
      body: levelPage.body
    });

    const lessonUrls = extractPythonLessonUrls(levelPage.html, levelPage.url);
    lessonsFound += lessonUrls.length;
    const levelRecord = {
      id: new URL(levelPage.url).pathname.match(/l(\d{2})/u)?.[1] ?? '',
      title: levelPage.title,
      url: levelPage.url,
      lessons: []
    };

    for (const [lessonIndex, lessonUrl] of lessonUrls.entries()) {
      await wait(requests++ === 0 ? 0 : delayMs);
      try {
        const lessonPage = await fetchPage(lessonUrl);
        const pairs = extractPythonAnswerPairs(lessonPage.body);
        savePublicPage({
          url: lessonPage.url,
          source: 'StudentPlatformEG public QUREO Python answer guide',
          title: lessonPage.title,
          body: lessonPage.body
        });

        const lessonId = new URL(lessonPage.url).pathname.split('/').filter(Boolean).at(-1);
        const lessonNumber = lessonId?.match(/-s(\d+)$/u)?.[1] ?? String(lessonIndex + 1).padStart(2, '0');
        const expectedMatch = lessonPage.body.match(/(\d+)\s+سؤال(?:\s+وإجابة)?\s+في هذا الدرس/u);
        const expectedCount = expectedMatch ? Number(expectedMatch[1]) : null;

        for (const pair of pairs) {
          answers.push({
            id: `${lessonId}-q${pair.question_number}`,
            level_id: levelRecord.id,
            level_title: levelRecord.title,
            lesson_id: lessonId,
            lesson_title: lessonPage.title,
            question_number: pair.question_number,
            question: pair.question,
            answer: pair.answer,
            source_url: lessonPage.url
          });
        }

        levelRecord.lessons.push({
          id: lessonId,
          title: lessonPage.title,
          url: lessonPage.url,
          answer_count: pairs.length,
          expected_answer_count: expectedCount
        });
        lessonsFetched++;

        if (expectedCount !== null && expectedCount !== pairs.length) {
          countMismatches.push({
            url: lessonPage.url,
            expected: expectedCount,
            extracted: pairs.length
          });
        }
      } catch (error) {
        failedPages.push({ url: lessonUrl, error: error.message });
      }

      onProgress({
        message: `Level ${levelIndex + 1}/${levelUrls.length} · lesson ${lessonIndex + 1}/${lessonUrls.length} · ${answers.length} answers`
      });
    }

    levels.push(levelRecord);
  }

  if (!answers.length) throw new Error('No answer pairs were extracted. The guide page format may have changed.');

  const result = {
    format: 'qureo-public-answer-guide',
    schema_version: 1,
    course_id: 'python_short_ar',
    source: {
      name: 'StudentPlatformEG',
      url: PYTHON_ANSWER_INDEX_URL,
      note: 'Unofficial public reference. Verify answers against the current QUREO lesson before using them.'
    },
    exported_at: new Date().toISOString(),
    coverage: {
      levels_listed: levelUrls.length,
      levels_fetched: levels.length,
      lessons_found: lessonsFound,
      lessons_fetched: lessonsFetched,
      answers_extracted: answers.length,
      failed_pages: failedPages.length,
      count_mismatches: countMismatches.length
    },
    levels,
    answers,
    count_mismatches,
    failed_pages: failedPages
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryPath = OUTPUT_PATH + '.tmp';
  fs.writeFileSync(temporaryPath, JSON.stringify(result, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600
  });
  fs.renameSync(temporaryPath, OUTPUT_PATH);

  return { ...result.coverage, outputPath: OUTPUT_PATH };
}
