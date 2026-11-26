import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const COURSE_ORIGIN = 'https://me-tp.qureo.education';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function toCdpCookie(cookie) {
  const result = {
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly)
  };

  if (Number.isFinite(cookie.expires) && cookie.expires > Date.now()) {
    result.expires = cookie.expires / 1000;
  }

  if (cookie.hostOnly) {
    result.url = `https://${cookie.domain}${cookie.path || '/'}`;
  } else {
    result.domain = `.${String(cookie.domain || '').replace(/^\./, '')}`;
  }

  if (cookie.sameSite && ['Strict', 'Lax', 'None'].includes(cookie.sameSite)) {
    result.sameSite = cookie.sameSite;
  }

  return result;
}

export function buildLectureCompletionScript(lessonId) {
  const id = encodeURIComponent(String(lessonId));
  return `(async () => {
    const response = await fetch('/api/study/students/lectures/${id}/complete', {
      method: 'PUT',
      credentials: 'include',
      headers: { Accept: '*/*', 'Content-Type': 'application/json' }
    });
    return {
      status: response.status,
      ok: response.ok,
      body: (await response.text()).slice(0, 500)
    };
  })()`;
}

function findChromeExecutable() {
  const candidates = [
    process.env.QUREO_CHROME_PATH,
    process.env.CHROME_PATH,
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();

    socket.addEventListener('message', event => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message || 'Chrome DevTools Protocol error.'));
        else pending.resolve(message.result || {});
        return;
      }

      if (message.method) {
        for (const listener of this.listeners.get(message.method) || []) {
          if (listener.sessionId && listener.sessionId !== message.sessionId) continue;
          try {
            listener.callback(message.params || {});
          } catch {
          }
        }
      }
    });

    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Chrome closed the DevTools connection.'));
      }
      this.pending.clear();
    });

    socket.addEventListener('error', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Chrome DevTools connection failed.'));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to Chrome.')), 10000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Could not connect to Chrome DevTools.'));
      }, { once: true });
    });
    return new CdpConnection(socket);
  }

  send(method, params = {}, sessionId, timeoutMs = 15000) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Chrome DevTools connection is closed.'));
    }

    const id = ++this.nextId;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  on(method, callback, sessionId) {
    const listeners = this.listeners.get(method) || new Set();
    const entry = { callback, sessionId };
    listeners.add(entry);
    this.listeners.set(method, listeners);
    return () => {
      listeners.delete(entry);
      if (!listeners.size) this.listeners.delete(method);
    };
  }

  waitForEvent(method, sessionId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for Chrome event: ${method}`));
      }, timeoutMs);
      const unsubscribe = this.on(method, params => {
        clearTimeout(timer);
        unsubscribe();
        resolve(params);
      }, sessionId);
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {
    }
  }
}

async function waitForDevTools(profileDir, child, getStartupError) {
  const activePortFile = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + 20000;
  let exitedAt = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null && exitedAt === null) exitedAt = Date.now();

    if (fs.existsSync(activePortFile)) {
      const [portText] = fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
      const port = Number(portText);
      if (Number.isInteger(port) && port > 0) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/json/version`);
          if (response.ok) {
            const details = await response.json();
            if (details.webSocketDebuggerUrl) return details.webSocketDebuggerUrl;
          }
        } catch {
        }
      }
    }

    if (exitedAt !== null && Date.now() - exitedAt >= 2000) {
      throw new Error(getStartupError());
    }

    await sleep(100);
  }

  throw new Error(getStartupError('Chrome did not expose its local automation interface within 20 seconds.'));
}

export class QureoLectureBrowser {
  constructor(client, { onProgress = () => {} } = {}) {
    this.client = client;
    this.onProgress = onProgress;
    this.child = null;
    this.profileDir = null;
    this.cdp = null;
    this.sessionId = null;
    this.targetId = null;
    this.inFlightApi = new Set();
    this.lastApiActivity = Date.now();
    this.removeNetworkListeners = [];
    this.started = false;
    this.closed = false;
  }

  async start() {
    if (this.started) return;
    if (process.platform !== 'win32') {
      throw new Error('Automatic lesson initialization currently requires Chrome or Edge on Windows.');
    }

    const cookies = this.client?.jar?.cookies || [];
    const hasCourseSession = this.client?.jar?.header?.(`${COURSE_ORIGIN}/chapter/`) || '';
    if (!cookies.length || !hasCourseSession) {
      throw new Error('No active QUREO browser session is available. Run qureo login and try again.');
    }

    const executable = findChromeExecutable();
    if (!executable) {
      throw new Error('Chrome or Edge was not found. Install Chrome or set QUREO_CHROME_PATH to its executable.');
    }

    this.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qureo-lecture-'));
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--metrics-recording-only',
      '--mute-audio',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      `--user-data-dir=${this.profileDir}`,
      'about:blank'
    ];

    this.child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    this.child.stderr?.setEncoding('utf8');
    this.child.stderr?.on('data', chunk => {
      stderr = (stderr + chunk).slice(-6000);
    });
    let exitDetails = null;
    this.child.once('exit', (code, signal) => {
      exitDetails = { code, signal };
    });
    const getStartupError = fallback => {
      const exit = exitDetails
        ? `Chrome exited with code ${exitDetails.code ?? 'unknown'}${exitDetails.signal ? ` (signal ${exitDetails.signal})` : ''}.`
        : fallback || 'Chrome did not start its automation interface.';
      const diagnostic = stderr.trim();
      return [exit, diagnostic].filter(Boolean).join(' Chrome output: ');
    };
    const childError = new Promise((_, reject) => {
      this.child.once('error', reject);
    });

    try {
      const debuggerUrl = await Promise.race([
        waitForDevTools(this.profileDir, this.child, getStartupError),
        childError
      ]);
      this.cdp = await CdpConnection.connect(debuggerUrl);

      const target = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
      this.targetId = target.targetId;
      const attached = await this.cdp.send('Target.attachToTarget', {
        targetId: this.targetId,
        flatten: true
      });
      this.sessionId = attached.sessionId;

      await this.cdp.send('Page.enable', {}, this.sessionId);
      await this.cdp.send('Runtime.enable', {}, this.sessionId);
      await this.cdp.send('Network.enable', {}, this.sessionId);
      await this.cdp.send('Network.setUserAgentOverride', {
        userAgent: USER_AGENT,
        acceptLanguage: 'ar,en-US;q=0.9,en;q=0.8',
        platform: 'Windows'
      }, this.sessionId);
      await this.cdp.send('Network.setCookies', {
        cookies: cookies.map(toCdpCookie)
      }, this.sessionId);

      this.trackApiActivity();
      this.started = true;
    } catch (error) {
      await this.close();
      throw new Error(`Could not prepare the hidden QUREO browser: ${error.message}`);
    }
  }

  trackApiActivity() {
    const onRequest = params => {
      try {
        const url = new URL(params.request.url);
        if (url.origin !== COURSE_ORIGIN || !url.pathname.startsWith('/api/')) return;
        this.inFlightApi.add(params.requestId);
        this.lastApiActivity = Date.now();
      } catch {
      }
    };
    const onFinished = params => {
      if (this.inFlightApi.delete(params.requestId)) this.lastApiActivity = Date.now();
    };

    this.removeNetworkListeners.push(
      this.cdp.on('Network.requestWillBeSent', onRequest, this.sessionId),
      this.cdp.on('Network.loadingFinished', onFinished, this.sessionId),
      this.cdp.on('Network.loadingFailed', onFinished, this.sessionId)
    );
  }

  async waitForApiIdle(minWaitMs = 1500, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= minWaitMs && this.inFlightApi.size === 0 && Date.now() - this.lastApiActivity >= 650) {
        return true;
      }
      await sleep(100);
    }
    return false;
  }

  async evaluate(expression) {
    const result = await this.cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }, this.sessionId, 30000);
    if (result.exceptionDetails) {
      const message = result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        'A page-side operation failed.';
      throw new Error(message);
    }
    return result.result?.value;
  }

  async completeLecture(lessonId, lectureUrl) {
    await this.start();

    const parsed = new URL(lectureUrl);
    if (parsed.origin !== COURSE_ORIGIN || !parsed.pathname.includes(`/lecture/${lessonId}`)) {
      throw new Error('Refusing to open an unexpected QUREO lesson URL.');
    }

    this.onProgress(`  lesson ${lessonId}: opening the lesson in a hidden Chrome session to initialize QUREO`);
    const loaded = this.cdp.waitForEvent('Page.loadEventFired', this.sessionId, 30000);
    const navigation = await this.cdp.send('Page.navigate', { url: parsed.href }, this.sessionId);
    if (navigation.errorText) throw new Error(`QUREO lesson navigation failed: ${navigation.errorText}`);
    await loaded;
    const pageIdle = await this.waitForApiIdle();
    if (!pageIdle) {
      this.onProgress(`  lesson ${lessonId}: page API activity did not fully settle; continuing with bounded completion checks`);
    }

    const page = await this.evaluate(`({
      href: location.href,
      title: document.title,
      readyState: document.readyState,
      text: (document.body?.innerText || '').slice(0, 500)
    })`);

    if (!page?.href?.startsWith(COURSE_ORIGIN + '/chapter/')) {
      throw new Error('The hidden browser was redirected away from the QUREO lesson. Run qureo login to refresh the session.');
    }

    for (let attempt = 0; attempt <= 4; attempt++) {
      this.onProgress(attempt === 0
        ? `  lesson ${lessonId}: QUREO page initialized; submitting completion request`
        : `  lesson ${lessonId}: completion is still unavailable; retry ${attempt}/4 after page initialization`
      );
      const result = await this.evaluate(buildLectureCompletionScript(lessonId));
      if (!result || !Number.isInteger(result.status)) {
        throw new Error('The hidden browser did not return a valid lesson completion response.');
      }
      if (result.ok || result.status === 400 || result.status === 409 || result.status !== 404 || attempt === 4) {
        return result;
      }
      await this.waitForApiIdle(800, 4000);
    }
    throw new Error('The hidden browser exhausted its lesson completion attempts.');
  }

  async close() {
    if (this.closed) return;
    this.closed = true;

    for (const remove of this.removeNetworkListeners) remove();
    this.removeNetworkListeners = [];

    if (this.cdp) {
      await this.cdp.send('Browser.close', {}, undefined, 3000).catch(() => {});
      this.cdp.close();
      this.cdp = null;
    }

    if (this.child && this.child.exitCode === null) {
      await Promise.race([
        new Promise(resolve => this.child.once('exit', resolve)),
        sleep(3000)
      ]);
      if (this.child.exitCode === null && process.platform === 'win32' && this.child.pid) {
        await new Promise(resolve => {
          const killer = spawn('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true
          });
          killer.once('exit', resolve);
          killer.once('error', resolve);
        });
      }
    }

    if (this.profileDir) {
      try {
        fs.rmSync(this.profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
      }
      this.profileDir = null;
    }
  }
}
