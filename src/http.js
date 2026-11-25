import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SESSION_PATH } from './paths.js';

export const PORTAL = 'https://me-portal.qureo.education';
export const COURSE_ORIGIN = 'https://me-tp.qureo.education';
export const API_BASE = `${COURSE_ORIGIN}/api/study`;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function runPowerShell(script, input) {
  if (process.platform !== 'win32') throw new Error('Encrypted session storage currently requires Windows DPAPI.');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    input, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || 'PowerShell DPAPI operation failed.').trim());
  return result.stdout;
}

function protect(text) {
  const script = [
    '$plain = [Console]::In.ReadToEnd()',
    '$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force',
    '$encrypted = ConvertFrom-SecureString -SecureString $secure',
    '[Console]::Out.Write($encrypted)',
    '$plain = $null'
  ].join('; ');
  return runPowerShell(script, text).trim();
}

function unprotect(text) {
  const script = [
    '$encrypted = [Console]::In.ReadToEnd().Trim()',
    '$secure = ConvertTo-SecureString -String $encrypted',
    '$plain = ConvertFrom-SecureString -SecureString $secure -AsPlainText',
    '[Console]::Out.Write($plain)',
    '$secure.Dispose()'
  ].join('; ');
  return runPowerShell(script, text);
}

function parseSetCookie(header, requestUrl) {
  const [first, ...attrs] = header.split(';');
  const split = first.indexOf('=');
  if (split < 1) return null;
  const url = new URL(requestUrl);
  const cookie = {
    name: first.slice(0, split).trim(), value: first.slice(split + 1).trim(),
    domain: url.hostname, hostOnly: true, path: '/', secure: false, expires: null
  };
  for (const raw of attrs) {
    const [name, ...valueParts] = raw.trim().split('=');
    const key = name.toLowerCase();
    const value = valueParts.join('=').trim();
    if (key === 'domain' && value) { cookie.domain = value.replace(/^\./, '').toLowerCase(); cookie.hostOnly = false; }
    if (key === 'path' && value.startsWith('/')) cookie.path = value;
    if (key === 'secure') cookie.secure = true;
    if (key === 'max-age') cookie.expires = Date.now() + Math.max(0, Number(value) || 0) * 1000;
    if (key === 'expires' && value) { const date = Date.parse(value); if (Number.isFinite(date)) cookie.expires = date; }
  }
  return cookie;
}

class CookieJar {
  constructor(cookies = []) { this.cookies = cookies; }
  absorb(response, url) {
    const values = response.headers.getSetCookie?.() || [];
    for (const header of values) {
      const cookie = parseSetCookie(header, url);
      if (!cookie) continue;
      this.cookies = this.cookies.filter(c => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path));
      if (!header.toLowerCase().includes('max-age=0') && !/expires=Thu, 01 Jan 1970/i.test(header)) this.cookies.push(cookie);
    }
  }
  header(url) {
    const u = new URL(url);
    const now = Date.now();
    this.cookies = this.cookies.filter(c => !c.expires || c.expires > now);
    return this.cookies.filter(c => {
      const domainOk = c.hostOnly ? u.hostname === c.domain : (u.hostname === c.domain || u.hostname.endsWith(`.${c.domain}`));
      return domainOk && u.pathname.startsWith(c.path) && (!c.secure || u.protocol === 'https:');
    }).map(c => `${c.name}=${c.value}`).join('; ');
  }
}

function assertQureoUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['me-portal.qureo.education', 'me-tp.qureo.education'].includes(parsed.hostname)) {
    throw new Error('Blocked request outside the known QUREO HTTPS hosts.');
  }
  return parsed.href;
}

export class QureoHttpClient {
  constructor(cookies = []) {
    this.jar = new CookieJar(cookies);
  }

  async request(url, options = {}) {
    let currentUrl = assertQureoUrl(url);
    const redirectMode = options.redirect || 'follow';
    let method = options.method || 'GET';
    let body = options.body;
    const baseHeaders = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json, text/plain, */*',
      'Referer': currentUrl.startsWith(COURSE_ORIGIN) ? `${COURSE_ORIGIN}/` : `${PORTAL}/login`,
      ...(options.headers || {})
    };

    const timeoutMs = Number.isFinite(Number(options.timeoutMs))
      ? Math.min(120000, Math.max(1000, Number(options.timeoutMs)))
      : 30000;
    const fetchOptions = { ...options };
    delete fetchOptions.timeoutMs;

    for (let hop = 0; hop <= 5; hop++) {
      const headers = { ...baseHeaders };
      const cookie = this.jar.header(currentUrl);
      if (cookie) headers.Cookie = cookie;
      const response = await fetch(currentUrl, {
        ...fetchOptions,
        method,
        body,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs)
      });
      this.jar.absorb(response, currentUrl);

      const location = response.headers.get('location');
      const isRedirect = [301, 302, 303, 307, 308].includes(response.status) && location;
      if (!isRedirect || redirectMode === 'manual') return response;
      await response.body?.cancel().catch(() => {});
      if (hop === 5) throw new Error('QUREO redirected too many times.');

      currentUrl = assertQureoUrl(new URL(location, currentUrl).href);
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
        delete baseHeaders['Content-Type'];
      }
      baseHeaders.Referer = currentUrl.startsWith(COURSE_ORIGIN) ? `${COURSE_ORIGIN}/` : `${PORTAL}/login`;
    }
    throw new Error('QUREO request redirect handling failed.');
  }

  async json(path) {
    const response = await this.request(`${API_BASE}${path}`, { method: 'GET' });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = data?.not_fulfill_preconditions
        ? 'PRECONDITION_NOT_FULFILLED'
        : response.status === 401
          ? 'AUTH_EXPIRED'
          : response.status === 403
            ? 'FORBIDDEN'
            : 'HTTP_ERROR';
      const message = code === 'PRECONDITION_NOT_FULFILLED'
        ? `QUREO preconditions are not fulfilled for GET ${path} (HTTP 403).`
        : code === 'AUTH_EXPIRED'
          ? `QUREO API authentication expired (HTTP 401). Run qureo login again.`
          : code === 'FORBIDDEN'
            ? `QUREO denied access to GET ${path} (HTTP 403).`
            : `QUREO API request failed: GET ${path} returned HTTP ${response.status}.`;
      const error = new Error(message);
      error.code = code;
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    if (data === null) throw new Error(`QUREO returned a non-JSON response for ${path}.`);
    return data;
  }

  async login(studentId, password) {
    const response = await this.request(`${PORTAL}/oauth2/password-login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        'Origin': PORTAL,
        'Referer': `${PORTAL}/login`
      },
      body: JSON.stringify({ student_id: studentId, password })
    });

    if (![200, 201, 202, 204, 302, 303].includes(response.status)) {
      throw new Error(`QUREO login failed (HTTP ${response.status}). Check the student ID/password and try again.`);
    }

    const userResponse = await this.request(`${PORTAL}/oauth2/userinfo`, { method: 'GET' });
    if (!userResponse.ok) throw new Error(`Login request returned HTTP ${response.status}, but account verification failed (HTTP ${userResponse.status}). Check the ID/password or complete any required account step.`);
    const contentType = userResponse.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('json')) throw new Error('QUREO login verification did not return JSON. Check the account credentials and try again.');
    const userInfo = await userResponse.json().catch(() => ({}));

    // Some accounts establish the learning-host session only after the portal handshake.
    // Failure here does not invalidate a verified portal login; the first API read will report it.
    try {
      await this.request(`${COURSE_ORIGIN}/?content_id=javascript_ar`, { method: 'GET' });
    } catch {
      // Keep the verified portal session and let the first course/API request surface any issue.
    }

    return userInfo;
  }

  async getUserInfo() {
    const response = await this.request(`${PORTAL}/oauth2/userinfo`, { method: 'GET' });
    if (!response.ok) throw new Error(`Not logged in or session expired (HTTP ${response.status}). Run qureo login.`);
    if (!(response.headers.get('content-type') || '').toLowerCase().includes('json')) throw new Error('QUREO returned a non-JSON login page. Run qureo login again.');
    return response.json();
  }

  saveSession(metadata = {}) {
    const payload = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), cookies: this.jar.cookies, metadata });
    fs.writeFileSync(SESSION_PATH, protect(payload), { encoding: 'utf8', mode: 0o600 });
  }

  static loadSession() {
    if (!fs.existsSync(SESSION_PATH)) throw new Error('No saved QUREO session. Run `qureo login` first.');
    let payload;
    try { payload = JSON.parse(unprotect(fs.readFileSync(SESSION_PATH, 'utf8'))); }
    catch { throw new Error('Could not decrypt the saved session. Log in again under the same Windows user account.'); }
    if (!Array.isArray(payload.cookies)) throw new Error('Saved session is invalid. Run qureo login again.');
    return new QureoHttpClient(payload.cookies);
  }

  static clearSession() {
    if (fs.existsSync(SESSION_PATH)) fs.rmSync(SESSION_PATH, { force: true });
  }
}

