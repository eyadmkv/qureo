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
  if (!value && !/[\r\n]/u.test(raw) && !/\bcurl\b/i.test(raw)) {
    try { return normalizeCookie(raw); } catch {}
  }
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


function tokenizeCurlCommand(source) {
  const input = String(source || '').replace(/\\\r?\n/gu, ' ').trim();
  if (!/^curl(?:\.exe)?(?:\s|$)/iu.test(input)) {
    throw new Error('Clipboard does not contain a cURL request. In DevTools choose Copy as cURL.');
  }

  const tokens = [];
  let token = '';
  let quote = null;
  let started = false;

  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (quote === "'") {
      if (character === "'") quote = null;
      else token += character;
      started = true;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = null;
      else if (character === '\\' && index + 1 < input.length) token += input[++index];
      else token += character;
      started = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (character === '\\' && index + 1 < input.length) {
      const next = input[index + 1];
      if (next === '\r' || next === '\n') {
        index++;
        if (next === '\r' && input[index + 1] === '\n') index++;
      } else {
        token += input[++index];
      }
      started = true;
    } else if (/\s/u.test(character)) {
      if (started) tokens.push(token);
      token = '';
      started = false;
    } else {
      token += character;
      started = true;
    }
  }

  if (quote) throw new Error('The copied cURL command has an unmatched quote.');
  if (started) tokens.push(token);
  return tokens.slice(1);
}

function redactSprixValue(value, key = '') {
  if (/(?:cookie|token|password|secret|authorization|session|csrf|xsrf|api[_-]?key|email|phone|login[_-]?id)/iu.test(key)) {
    return '[REDACTED]';
  }
  if (Array.isArray(value)) return value.map(item => redactSprixValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [
      name,
      redactSprixValue(item, name)
    ]));
  }
  return value;
}

export function parseSprixCurlRequest(source) {
  const args = tokenizeCurlCommand(source);
  let method = '';
  let requestUrl = '';
  let body = null;
  let bodyLength = 0;
  const headers = {};
  const redactedHeaders = [];

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const next = args[index + 1];
    if (argument === '-X' || argument === '--request') {
      method = String(next || '').toUpperCase();
      index++;
    } else if (argument.startsWith('--request=')) {
      method = argument.slice('--request='.length).toUpperCase();
    } else if (argument === '--url') {
      requestUrl = next || '';
      index++;
    } else if (argument.startsWith('--url=')) {
      requestUrl = argument.slice('--url='.length);
    } else if (argument === '-H' || argument === '--header') {
      const header = String(next || '');
      index++;
      const separator = header.indexOf(':');
      if (separator > 0) {
        const name = header.slice(0, separator).trim().toLowerCase();
        const value = header.slice(separator + 1).trim();
        if (/^(?:cookie|set-cookie|authorization|proxy-authorization|x-.*(?:token|key|secret)|.*(?:csrf|xsrf).*)$/iu.test(name)) {
          redactedHeaders.push(name);
        } else if (['accept', 'content-type', 'origin', 'referer', 'user-agent', 'x-requested-with'].includes(name)) {
          headers[name] = name === 'referer' ? value.split('?')[0] : value;
        } else {
          redactedHeaders.push(name);
        }
      }
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--json'].includes(argument)) {
      body = next ?? '';
      bodyLength = Buffer.byteLength(body, 'utf8');
      index++;
    } else if (/^https?:\/\//iu.test(argument) && !requestUrl) {
      requestUrl = argument;
    }
  }

  if (!requestUrl) throw new Error('Could not find the request URL in the copied cURL command.');
  let parsedUrl;
  try {
    parsedUrl = new URL(requestUrl);
  } catch {
    throw new Error('The copied request URL is invalid.');
  }
  if (parsedUrl.protocol !== 'https:' ||
      !(parsedUrl.hostname === 'spx-learning-square.com' || parsedUrl.hostname.endsWith('.spx-learning-square.com')) ||
      parsedUrl.username || parsedUrl.password) {
    throw new Error('Only HTTPS SPRIX Learning Square requests can be inspected.');
  }

  if (!method) method = body === null ? 'GET' : 'POST';
  parsedUrl.hash = '';
  for (const key of parsedUrl.searchParams.keys()) {
    if (/(?:token|key|secret|auth|session|code|signature)/iu.test(key)) {
      parsedUrl.searchParams.set(key, '[REDACTED]');
    }
  }

  let parsedBody = null;
  let bodyFormat = 'none';
  if (body !== null) {
    try {
      parsedBody = redactSprixValue(JSON.parse(body));
      bodyFormat = 'json';
    } catch {
      parsedBody = '[non-JSON body omitted]';
      bodyFormat = 'non-json';
    }
  }

  return {
    method,
    url: parsedUrl.origin + parsedUrl.pathname + parsedUrl.search,
    headers,
    redactedHeaders: [...new Set(redactedHeaders)].sort(),
    bodyFormat,
    body: parsedBody,
    bodyLength
  };
}


function validId(value, label) {
  const text = String(value ?? '');
  const number = Number(text);
  if (!/^[1-9]\d*$/u.test(text) || !Number.isSafeInteger(number)) {
    throw new Error(label + ' must be a positive numeric ID.');
  }
  return number;
}


export function selectSprixSubjectId(subjects, requestedSubjectId = null) {
  if (requestedSubjectId !== null &&
      requestedSubjectId !== undefined &&
      String(requestedSubjectId).trim() !== '' &&
      String(requestedSubjectId).toLowerCase() !== 'auto') {
    return validId(requestedSubjectId, 'Subject ID');
  }

  if (!Array.isArray(subjects)) {
    throw new Error('SPRIX subjects response did not contain a subject list.');
  }

  const activeCourses = subjects.filter(subject =>
    subject &&
    subject.status === 'active' &&
    subject.kind !== 'game' &&
    Number(subject.total_items) > 0
  );
  const financialLiteracyCourses = activeCourses.filter(subject =>
    subject.subject_type === 'financial_literacy' ||
    subject.course_code === 'financial_literacy'
  );
  const candidates = financialLiteracyCourses.length > 0
    ? financialLiteracyCourses
    : activeCourses;

  if (candidates.length === 1) {
    return validId(candidates[0].id, 'Subject ID');
  }

  const available = subjects
    .filter(subject => subject && subject.id !== undefined)
    .map(subject => '#' + subject.id + ' ' + (subject.name || subject.subject_type || 'Unnamed subject'))
    .join(', ');

  if (candidates.length === 0) {
    throw new Error(
      'No active SPRIX learning course with items was found. Available subjects: ' +
      (available || 'none') +
      '. Check the account in the browser or pass --subject <id> explicitly.'
    );
  }

  const matches = candidates
    .map(subject => '#' + subject.id + ' ' + (subject.name || subject.subject_type || 'Unnamed subject'))
    .join(', ');
  throw new Error(
    'More than one SPRIX course is available. Choose one with --subject <id>: ' + matches
  );
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
  constructor({ cookie, origin = SPRIX_ORIGIN, fetchImpl = globalThis.fetch, timeoutMs = 30000, persistSession = false, metadata = {} } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable in this Node.js runtime.');
    this.origin = normalizeOrigin(origin);
    this.cookie = normalizeCookie(cookie);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.min(120000, Math.max(1000, Number(timeoutMs) || 30000));
    this.persistSession = Boolean(persistSession);
    this.metadata = metadata && typeof metadata === 'object' ? metadata : {};
  }

  static async login({ loginId, password, origin = SPRIX_ORIGIN, fetchImpl = globalThis.fetch, timeoutMs = 30000, subjectId = null } = {}) {
    const username = String(loginId || '').trim();
    if (!username) throw new Error('SPRIX Login ID is required.');
    if (typeof password !== 'string' || !password) throw new Error('SPRIX password is required.');
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable in this Node.js runtime.');

    const normalizedOrigin = normalizeOrigin(origin);
    const url = normalizedOrigin + '/api/v1/auth/login';
    const timeout = Math.min(120000, Math.max(1000, Number(timeoutMs) || 30000));
    let response;

    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Origin: normalizedOrigin,
          Referer: normalizedOrigin + '/login',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({ login_id: username, password }),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout)
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new SprixHttpError(
        timedOut ? 'SPRIX login request timed out.' : 'SPRIX login request failed: ' + error.message,
        { code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR' }
      );
    }

    const responseText = await response.text();
    let payload = null;
    if (responseText) {
      try { payload = JSON.parse(responseText); } catch {}
    }

    if (!response.ok || payload?.success === false || payload === null) {
      const detail = payload?.message || payload?.error?.message || payload?.error || 'Login was rejected (HTTP ' + response.status + ').';
      throw new SprixHttpError('SPRIX login failed: ' + detail, {
        code: response.status === 401 || response.status === 403 ? 'AUTH_REJECTED' : 'LOGIN_FAILED',
        status: response.status,
        payload
      });
    }

    const cookie = mergeSetCookies('', response);
    if (!cookie) {
      throw new SprixHttpError('SPRIX accepted the login response but did not return session cookies. Use the browser-session import fallback and report this response status.', {
        code: 'NO_SESSION_COOKIE',
        status: response.status,
        payload
      });
    }

    const session = new SprixHttpClient({
      cookie,
      origin: normalizedOrigin,
      fetchImpl,
      timeoutMs
    });
    const resolvedSubjectId = await session.resolveSubjectId(subjectId);
    const curriculum = await session.getCurriculum(resolvedSubjectId);
    return { session, curriculum, subjectId: resolvedSubjectId };
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
    return new SprixHttpClient({ cookie: payload.cookie, origin: payload.origin || SPRIX_ORIGIN, metadata: payload.metadata || {}, ...options, persistSession: true });
  }

  saveSession(metadata = {}) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    this.metadata = { ...this.metadata, ...metadata };
    const payload = JSON.stringify({ version: 1, origin: this.origin, cookie: this.cookie, savedAt: new Date().toISOString(), metadata: this.metadata });
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
          Referer: referer || this.origin + '/dashboard',
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

  async getSubjects() {
    const payload = await this.request('/api/v1/subjects');
    if (!Array.isArray(payload.data)) {
      throw new SprixHttpError('SPRIX subjects response did not contain a data array.', {
        code: 'INVALID_RESPONSE',
        status: 200,
        payload
      });
    }
    return payload.data;
  }

  async resolveSubjectId(subjectId = null) {
    if (subjectId !== null &&
        subjectId !== undefined &&
        String(subjectId).trim() !== '' &&
        String(subjectId).toLowerCase() !== 'auto') {
      return validId(subjectId, 'Subject ID');
    }

    if (this.metadata.subjectId !== undefined && this.metadata.subjectId !== null) {
      return validId(this.metadata.subjectId, 'Saved subject ID');
    }

    const subjects = await this.getSubjects();
    const resolvedSubjectId = selectSprixSubjectId(subjects);
    this.metadata.subjectId = resolvedSubjectId;
    if (this.persistSession) this.saveSession();
    return resolvedSubjectId;
  }

  async getCurriculum(subjectId = null) {
    const id = await this.resolveSubjectId(subjectId);
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

  async unlockAchievements(subjectId = null) {
    const id = await this.resolveSubjectId(subjectId);
    return this.request('/api/v1/subjects/' + id + '/achievements/unlock', { method: 'POST', body: {} });
  }
}
