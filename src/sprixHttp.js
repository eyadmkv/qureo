import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DATA_DIR } from './paths.js';

export const SPRIX_ORIGIN = 'https://egy.app.spx-learning-square.com';
const SESSION_DIR = path.join(DATA_DIR, 'sprix');
const SESSION_PATH = path.join(SESSION_DIR, 'session.dpapi');

function runPowerShell(script, input) {
  if (process.platform !== 'win32') throw new Error('SPRIX session encryption requires Windows DPAPI.');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    input, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || 'Windows DPAPI operation failed.').trim());
  return result.stdout;
}

function protect(value) {
  const script = [
    '$plain = [Console]::In.ReadToEnd()',
    '$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force',
    '$encrypted = ConvertFrom-SecureString -SecureString $secure',
    '[Console]::Out.Write($encrypted)',
    '$secure.Dispose()',
    '$plain = $null'
  ].join('; ');
  return runPowerShell(script, value).trim();
}

function unprotect(value) {
  const script = [
    '$encrypted = [Console]::In.ReadToEnd().Trim()',
    '$secure = ConvertTo-SecureString -String $encrypted',
    '$plain = ConvertFrom-SecureString -SecureString $secure -AsPlainText',
    '[Console]::Out.Write($plain)',
    '$secure.Dispose()'
  ].join('; ');
  return runPowerShell(script, value);
}

function normalizeOrigin(value = SPRIX_ORIGIN) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid SPRIX origin URL.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !(host === 'spx-learning-square.com' || host.endsWith('.spx-learning-square.com')) || url.username || url.password) {
    throw new Error('Only HTTPS *.spx-learning-square.com origins are allowed.');
  }
  return url.origin;
}

function normalizeCookie(value) {
  const cookie = String(value || '').trim().replace(/^cookie\s*:\s*/i, '');
  if (!cookie || /[\r\n]/u.test(cookie)) throw new Error('A single-line Cookie header is required.');
  const parts = cookie.split(';').map(x => x.trim()).filter(Boolean);
  if (!parts.length || parts.some(x => !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+=.*$/u.test(x))) {
    throw new Error('The copied value does not look like a valid Cookie header.');
  }
  return parts.join('; ');
}

export function parseSprixCookieHeader(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) throw new Error('Clipboard is empty. Copy an authenticated SPRIX request as cURL first.');
  let value = null;
  const line = raw.match(/^\s*cookie\s*:\s*([^\r\n]+)\s*$/im);
  if (line) value = line[1];
  if (!value) {
    const header = raw.match(/(?:-H|--header)\s+(['"])\s*cookie\s*:\s*([\s\S]*?)\1/i);
    if (header) value = header[2];
  }
  if (!value) {
    const cookie = raw.match(/(?:-b|--cookie)\s+(['"])([\s\S]*?)\1/i);
    if (cookie) value = cookie[2];
  }
  if (!value && !/[\r\n]/u.test(raw) && !/\bcurl\b/i.test(raw)) value = raw;
  if (!value) throw new Error('No Cookie header found. Copy an authenticated SPRIX request as cURL from DevTools Network.');
  return normalizeCookie(value);
}

export function readSprixClipboard() {
  if (process.platform !== 'win32') throw new Error('Clipboard import requires Windows PowerShell.');
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw'], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || 'Could not read Windows clipboard.').trim());
  return result.stdout.replace(/^\uFEFF/u, '');
}

function validId(value, label) {
  const text = String(value ?? '');
  const number = Number(text);
  if (!/^[1-9]\d*$/u.test(text) || !Number.isSafeInteger(number)) {
    throw new Error(label + ' must be a positive numeric ID.');
  }
  return number;
}

function mergeSetCookies(current, response) {
  const headers = response.headers.getSetCookie?.() || [];
  if (!headers.length) return current;
  const cookies = new Map(current.split(';').map(x => x.trim()).filter(Boolean).map(x => {
    const i = x.indexOf('=');
    return [x.slice(0, i), x.slice(i + 1)];
  }));
  for (const header of headers) {
    const first = String(header).split(';', 1)[0].trim();
    const i = first.indexOf('=');
    if (i < 1) continue;
    const name = first.slice(0, i);
    if (/max-age\s*=\s*0/i.test(header) || /expires\s*=\s*Thu,\s*01 Jan 1970/i.test(header)) cookies.delete(name);
    else cookies.set(name, first.slice(i + 1));
  }
  return [...cookies.entries()].map(([k, v]) => k + '=' + v).join('; ');
}

export class SprixHttpError extends Error {
  constructor(message, { code = 'SPRIX_HTTP_ERROR', status = null, payload = null } = {}) {
    super(message);
    this.name = 'SprixHttpError';
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

export class SprixHttpClient {
  constructor({ cookie, origin = SPRIX_ORIGIN, fetchImpl = globalThis.fetch, timeoutMs = 30000, persistSession = false } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable in this Node.js runtime.');
    this.origin = normalizeOrigin(origin);
    this.cookie = normalizeCookie(cookie);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.min(120000, Math.max(1000, Number(timeoutMs) || 30000));
    this.persistSession = Boolean(persistSession);
  }

  static hasSession() {
    return fs.existsSync(SESSION_PATH);
  }

  static loadSession(options = {}) {
    if (!fs.existsSync(SESSION_PATH)) throw new Error('No saved SPRIX session. Run sprix login --clipboard first.');
    let payload;
    try { payload = JSON.parse(unprotect(fs.readFileSync(SESSION_PATH, 'utf8'))); }
    catch { throw new Error('Could not decrypt the SPRIX session. Import it again on this Windows account.'); }
    if (payload?.version !== 1 || typeof payload.cookie !== 'string') throw new Error('Saved SPRIX session is invalid.');
    return new SprixHttpClient({ cookie: payload.cookie, origin: payload.origin || SPRIX_ORIGIN, ...options, persistSession: true });
  }

  saveSession(metadata = {}) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    const payload = JSON.stringify({ version: 1, origin: this.origin, cookie: this.cookie, savedAt: new Date().toISOString(), metadata });
    const temp = SESSION_PATH + '.tmp';
    fs.writeFileSync(temp, protect(payload), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, SESSION_PATH);
    this.persistSession = true;
  }

  static clearSession() {
    if (fs.existsSync(SESSION_PATH)) fs.rmSync(SESSION_PATH, { force: true });
  }

  async request(apiPath, { method = 'GET', body, referer, headers = {} } = {}) {
    const url = new URL(apiPath, this.origin + '/');
    if (url.origin !== this.origin || !url.pathname.startsWith('/api/v1/')) {
      throw new Error('Blocked SPRIX request outside this origin and /api/v1/.');
    }
    method = String(method).toUpperCase();
    if (!['GET', 'POST', 'PUT'].includes(method)) throw new Error('Unsupported SPRIX method: ' + method);
    if (method === 'GET' && body !== undefined) throw new Error('GET requests cannot include a body.');

    let response;
    try {
      response = await this.fetchImpl(url.href, {
        method,
        headers: {
          Accept: 'application/json, text/plain, */*',
          Origin: this.origin,
          Referer: referer || this.origin + '/subjects/7/curriculum',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
          Cookie: this.cookie
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new SprixHttpError(timeout
        ? 'SPRIX request timed out: ' + method + ' ' + url.pathname
        : 'SPRIX network request failed: ' + error.message, { code: timeout ? 'TIMEOUT' : 'NETWORK_ERROR' });
    }

    const refreshed = mergeSetCookies(this.cookie, response);
    if (refreshed !== this.cookie) {
      this.cookie = refreshed;
      if (this.persistSession) this.saveSession();
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location') || '';
      const expired = /\/login(?:[/?#]|$)/i.test(location);
      throw new SprixHttpError(expired ? 'SPRIX session expired. Run sprix login --clipboard again.' :
        'SPRIX redirected ' + method + ' ' + url.pathname + ' (HTTP ' + response.status + ').',
      { code: expired ? 'AUTH_EXPIRED' : 'REDIRECT', status: response.status });
    }

    const text = await response.text();
    let payload = null;
    if (text) { try { payload = JSON.parse(text); } catch {} }
    if (response.status === 401 || response.status === 403) {
      throw new SprixHttpError('SPRIX rejected ' + method + ' ' + url.pathname + ' (HTTP ' + response.status + '). Re-import the browser session if still signed in.',
        { code: response.status === 401 ? 'AUTH_EXPIRED' : 'FORBIDDEN', status: response.status, payload });
    }
    if (!response.ok) {
      const detail = payload?.message || payload?.error?.message || payload?.error || 'HTTP ' + response.status;
      throw new SprixHttpError('SPRIX ' + method + ' ' + url.pathname + ' failed: ' + detail,
        { code: 'HTTP_ERROR', status: response.status, payload });
    }
    if (!payload || typeof payload !== 'object') {
      throw new SprixHttpError('SPRIX returned non-JSON data for ' + url.pathname + '.', { code: 'INVALID_RESPONSE', status: response.status });
    }
    if (payload.success === false) {
      const detail = payload.message || payload.error?.message || payload.error || 'The API rejected the request.';
      throw new SprixHttpError('SPRIX rejected ' + method + ' ' + url.pathname + ': ' + detail,
        { code: 'API_REJECTED', status: response.status, payload });
    }
    return payload;
  }

  async getCurriculum(subjectId = 7) {
    const id = validId(subjectId, 'Subject ID');
    const payload = await this.request('/api/v1/subjects/' + id + '/curriculum');
    if (!Array.isArray(payload.data)) throw new SprixHttpError('Curriculum response did not contain a data array.', { code: 'INVALID_RESPONSE', status: 200, payload });
    return payload.data;
  }

  async getChapterBlocks(chapterId) {
    const id = validId(chapterId, 'Chapter ID');
    const payload = await this.request('/api/v1/chapters/' + id + '/blocks');
    if (!payload.data || typeof payload.data !== 'object') throw new SprixHttpError('Chapter response did not contain data.', { code: 'INVALID_RESPONSE', status: 200, payload });
    return payload.data;
  }

  answerChapterQuestion(chapterId, blockId, optionId, hintUsed = 0) {
    const chapter = validId(chapterId, 'Chapter ID');
    const block = validId(blockId, 'Block ID');
    const option = validId(optionId, 'Option ID');
    const hint = Number(hintUsed) ? 1 : 0;
    return this.request('/api/v1/chapters/' + chapter + '/answer', {
      method: 'POST', body: { block_id: block, selected_option_id: option, hint_used: hint }
    });
  }

  completeChapter(chapterId) {
    return this.request('/api/v1/chapters/' + validId(chapterId, 'Chapter ID') + '/complete', { method: 'POST', body: {} });
  }

  getReviewItems(reviewId) {
    return this.request('/api/v1/reviews/' + validId(reviewId, 'Review ID') + '/items');
  }

  completeReview(reviewId) {
    return this.request('/api/v1/reviews/' + validId(reviewId, 'Review ID') + '/complete', { method: 'POST', body: {} });
  }

  startTest(testId) {
    return this.request('/api/v1/tests/' + validId(testId, 'Test ID') + '/start', { method: 'POST', body: {} });
  }

  answerTestQuestion(testId, testQuestionId, optionId) {
    const test = validId(testId, 'Test ID');
    const question = validId(testQuestionId, 'Test question ID');
    const option = validId(optionId, 'Option ID');
    return this.request('/api/v1/tests/' + test + '/questions/' + question + '/answer', {
      method: 'PUT', body: { selected_option_id: option }
    });
  }

  submitTest(testId) {
    return this.request('/api/v1/tests/' + validId(testId, 'Test ID') + '/submit', { method: 'POST', body: {} });
  }

  unlockAchievements(subjectId = 7) {
    return this.request('/api/v1/subjects/' + validId(subjectId, 'Subject ID') + '/achievements/unlock', { method: 'POST', body: {} });
  }
}
