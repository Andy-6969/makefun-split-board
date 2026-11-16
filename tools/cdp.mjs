// Shared plumbing for the screenshot and UI test scripts (Node 22, standard library only): serve app/ with
// serve.ts, start headless Chrome with a throwaway profile under .shots-tmp/, and drive one page over the
// Chrome DevTools Protocol with Node's built-in WebSocket.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(check, timeoutMs, what) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch {}
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}

/** node serve.ts on a port; resolves once it answers. */
export async function startServer(port) {
  const child = spawn(process.execPath, ['serve.ts', '--port', String(port)], { cwd: ROOT, stdio: 'ignore' });
  await until(() => fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok), 10_000, 'serve.ts');
  return child;
}

/** Headless Chrome with remote debugging; returns the process and its browser WebSocket URL. */
export async function startChrome(debugPort) {
  const profile = join(ROOT, '.shots-tmp', `profile-${debugPort}`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const child = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    '--force-color-profile=srgb', '--disable-background-timer-throttling', 'about:blank',
  ], { stdio: 'ignore' });
  const version = await until(() => fetch(`http://127.0.0.1:${debugPort}/json/version`).then((r) => r.json()), 15_000, 'Chrome');
  return { child, wsUrl: version.webSocketDebuggerUrl, profile };
}

/** A CDP connection with flat sessions: send(method, params, sessionId) and event listeners. */
export class Cdp {
  static async connect(wsUrl) {
    const cdp = new Cdp(new WebSocket(wsUrl));
    await new Promise((ok, fail) => {
      cdp.ws.addEventListener('open', ok, { once: true });
      cdp.ws.addEventListener('error', fail, { once: true });
    });
    return cdp;
  }
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { ok, fail, method } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) fail(new Error(`${method}: ${message.error.message}`));
        else ok(message.result);
      } else if (message.method) for (const listener of this.listeners) listener(message);
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail, method }));
  }
  on(listener) {
    this.listeners.push(listener);
  }
  close() {
    this.ws.close();
  }
}

/** Opens a page at a viewport and records its requests, responses and console errors. */
export async function openPage(cdp, { width, height, mobile = false, scale = 1 }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = {
    sessionId,
    requests: [],
    statuses: new Map(),
    errors: [],
    send: (method, params) => cdp.send(method, params, sessionId),
  };
  cdp.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Network.requestWillBeSent') page.requests.push({ id: m.params.requestId, url: m.params.request.url, type: m.params.type });
    else if (m.method === 'Network.responseReceivedExtraInfo') page.statuses.set(m.params.requestId, m.params.statusCode);
    else if (m.method === 'Network.responseReceived' && !page.statuses.has(m.params.requestId)) page.statuses.set(m.params.requestId, m.params.response.status);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') page.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    else if (m.method === 'Runtime.exceptionThrown') page.errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') page.errors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  });
  await page.send('Network.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  page.resize = (w, h, isMobile = mobile) => page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: isMobile });
  await page.resize(width, height);
  page.evaluate = async (expression) => {
    const { result, exceptionDetails } = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  page.waitFor = (expression, timeoutMs = 60_000) => until(() => page.evaluate(expression), timeoutMs, expression);
  /** Sets the hash (or loads the URL) and waits for the route's live data: window.__shotReady. */
  page.go = async (url) => {
    if (url.startsWith('#')) await page.evaluate(`window.__shotReady = false; location.hash = ${JSON.stringify(url)}; true`);
    else await page.send('Page.navigate', { url });
    await sleep(50);
    await page.waitFor('window.__shotReady === true && document.fonts.status === "loaded"');
    await sleep(250);
  };
  page.close = () => cdp.send('Target.closeTarget', { targetId });
  return page;
}
