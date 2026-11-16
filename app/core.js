// First load: ETag-revalidating JSON cache, hash router (one lazy view per surface), hover/focus prefetch,
// keyed in-place patch, one countdown ticker, shared formatters.
export { cachedJSON, watchJSON, prefetchOnIntent, patchKeyedList, startCountdownTicker, route, apiPath, fields, setText, esc, money, count, ordinal, utcDate, dayDate, countdownText, countdownHTML, scoreText, viewState };

/** make.fun's public API: GET only, CORS open. */
const API_ORIGIN = 'https://make.fun';
/** Within this window an answer is reused from memory with no request at all. */
const FRESH_MS = 20_000;
/** The API's ETags change at most once a minute, so watched views revalidate on that beat. */
const REVALIDATE_EVERY_MS = 60_000;
const DAY_MS = 86_400_000;

/** path -> { data, etag, at }: parsed answers, kept for the whole visit (stale-while-revalidate). */
const jsonCache = new Map();
/** path -> Promise: one request per path at a time (request de-duplication). */
const inFlight = new Map();
/** path -> Set of callbacks a revalidation calls when the answer really changed. */
const watchers = new Map();
/** What the status line shows; every figure is counted here, nothing is estimated. */
const netStats = { calls: 0, cached: 0, notModified: 0, bytes: 0 };

/** The API paths each surface reads. */
const apiPath = {
  board: () => '/api/competitions?status=open&activity=times',
  bounty: (slug) => `/api/competitions/${encodeURIComponent(slug)}?submissions=summary`,
  leaderboard: (slug) => `/api/competitions/${encodeURIComponent(slug)}/leaderboard?rows=first`,
  profile: (handle) => `/api/profiles/${encodeURIComponent(handle)}`,
};

/** One route per surface: its view by literal import(), and the API paths started alongside it. */
const ROUTES = [
  { name: 'board', pattern: /^#?\/?$/, view: () => import('./view-board.js'), data: () => [apiPath.board()] },
  { name: 'leaderboard', pattern: /^#\/bounty\/([^/]+)\/leaderboard$/, view: () => import('./view-leaderboard.js'), data: ([slug]) => [apiPath.bounty(slug)] },
  { name: 'bounty', pattern: /^#\/bounty\/([^/]+)$/, view: () => import('./view-bounty.js'), data: ([slug]) => [apiPath.bounty(slug)] },
  { name: 'profile', pattern: /^#\/u\/([^/]+)$/, view: () => import('./view-profile.js'), data: ([handle]) => [apiPath.profile(handle)] },
];

class ApiError extends Error {
  constructor(status, retryAfter) {
    super(status === 429 ? `make.fun asked us to slow down${retryAfter ? `; try again in ${retryAfter} s` : ''}.` : status === 404 ? 'make.fun has nothing at this address.' : `make.fun answered ${status}.`);
    this.status = status;
  }
}

/** Fresh: from memory, no request. Stale: returned at once, revalidated in the background. Missing: fetched. */
function cachedJSON(path, freshMs = FRESH_MS) {
  const hit = jsonCache.get(path);
  if (!hit) return revalidate(path);
  netStats.cached++;
  showNetStats();
  if (Date.now() - hit.at > freshMs) revalidate(path).catch(() => {});
  return Promise.resolve(hit.data);
}

/**
 * cache: 'no-cache' makes the browser send If-None-Match itself (make.fun's 304 has no CORS header, so a manual
 * one fails); within the minute make.fun answers 304. A matching ETag skips reading and parsing: same object back.
 */
function revalidate(path) {
  const pending = inFlight.get(path);
  if (pending) return pending;
  const request = (async () => {
    netStats.calls++;
    showNetStats();
    const response = await fetch(API_ORIGIN + path, { cache: 'no-cache', credentials: 'omit' });
    if (!response.ok) throw new ApiError(response.status, response.headers.get('retry-after'));
    const etag = response.headers.get('etag');
    const previous = jsonCache.get(path);
    if (previous && etag && previous.etag === etag) {
      response.body?.cancel().catch(() => {});
      previous.at = Date.now();
      netStats.notModified++;
      showNetStats();
      return previous.data;
    }
    const text = await response.text();
    netStats.bytes += text.length;
    const data = JSON.parse(text);
    jsonCache.set(path, { data, etag, at: Date.now() });
    showNetStats();
    if (previous) for (const callback of watchers.get(path) ?? []) callback(data);
    return data;
  })().finally(() => inFlight.delete(path));
  inFlight.set(path, request);
  return request;
}

/** Calls onChange whenever a revalidation brings a changed answer; revalidates every minute while the tab is visible. */
function watchJSON(path, onChange, everyMs = REVALIDATE_EVERY_MS) {
  if (!watchers.has(path)) watchers.set(path, new Set());
  watchers.get(path).add(onChange);
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') revalidate(path).catch(() => {});
  }, everyMs);
  return () => {
    clearInterval(timer);
    watchers.get(path)?.delete(onChange);
  };
}

/** Starts the data a path needs if nothing holds it yet: no counting as a cache hit, no repeat while in flight. */
function warm(path) {
  if (!jsonCache.has(path) && !inFlight.has(path)) revalidate(path).catch(() => {});
}

/** On hover (after a short pause) or keyboard focus of an in-app link, loads its view module and its data. */
function prefetchOnIntent() {
  let timer = 0;
  const intent = (event, delay) => {
    const link = event.target.closest?.('a[href^="#/"]');
    if (!link) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const match = matchRoute(link.getAttribute('href'));
      if (!match) return;
      match.route.view().catch(() => {});
      for (const path of match.route.data(match.params)) warm(path);
    }, delay);
  };
  document.addEventListener('pointerover', (event) => intent(event, 70), { passive: true });
  document.addEventListener('pointerout', () => clearTimeout(timer), { passive: true });
  document.addEventListener('focusin', (event) => intent(event, 0));
}

let statsFrame = 0;
/** Writes the status line once per frame at most, into its one text node. */
function showNetStats() {
  if (statsFrame) return;
  statsFrame = requestAnimationFrame(() => {
    statsFrame = 0;
    const kb = netStats.bytes / 1024;
    const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
    setText(document.getElementById('net'), `${netStats.calls} API ${netStats.calls === 1 ? 'call' : 'calls'} · ${netStats.cached} cached · ${netStats.notModified} × 304 · ${size} JSON`);
  });
}

/** Keyed patch: kept keys are updated in place and moved only when out of order; new created, gone removed. */
function patchKeyedList(parent, items, keyOf, create, update) {
  const byKey = new Map();
  for (const element of parent.children) byKey.set(element.dataset.key, element);
  let cursor = parent.firstElementChild;
  for (const item of items) {
    const key = String(keyOf(item));
    let element = byKey.get(key);
    if (element) byKey.delete(key);
    else {
      element = create(item);
      element.dataset.key = key;
    }
    update(element, item);
    if (element === cursor) cursor = cursor.nextElementSibling;
    else parent.insertBefore(element, cursor);
  }
  for (const element of byKey.values()) element.remove();
}

/** The [data-f] descendants of an element by name, for setting text without querying again. */
function fields(element) {
  const found = {};
  for (const node of element.querySelectorAll('[data-f]')) found[node.dataset.f] = node;
  return found;
}

/** Sets an element's text only when it differs, reusing its text node. */
function setText(element, value) {
  if (!element) return;
  const text = String(value);
  const node = element.firstChild;
  if (node && node.nodeType === 3 && !node.nextSibling) {
    if (node.data !== text) node.data = text;
  } else if (element.textContent !== text) element.textContent = text;
}

/** Every element with class "cd" and a data-end time, found live (no registry to keep in step). */
const countdowns = document.getElementsByClassName('cd');

/** One timer for every countdown on the page: each second it rewrites their text nodes and nothing else. */
function startCountdownTicker() {
  const tick = () => {
    const now = Date.now();
    for (const element of countdowns) {
      const end = Date.parse(element.dataset.end);
      setText(element, countdownText(end - now));
      element.classList.toggle('soon', end > now && end - now < DAY_MS);
    }
  };
  tick();
  setInterval(tick, 1000);
  return tick;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const usdCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const integer = new Intl.NumberFormat('en-US');
const dateTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
const dateYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Text made safe for HTML. */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
/** '$1,000' for whole dollars, '$606.50' otherwise. */
function money(value) {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? usd.format(n) : usdCents.format(n);
}
const count = (n) => integer.format(Number(n) || 0);
function ordinal(n) {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${count(n)}${suffix}`;
}
/** 'Nov 16, 02:30 UTC' */
const utcDate = (iso) => `${dateTime.format(new Date(iso))} UTC`;
/** 'Nov 16, 2026' */
const dayDate = (iso) => dateYear.format(new Date(iso));
const pad = (n) => String(n).padStart(2, '0');
/** '8d 18h 04m', '3h 34m 27s', '4m 09s' or 'Closed'. */
function countdownText(ms) {
  if (ms <= 0) return 'Closed';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s % 60)}s`;
  return `${m}m ${pad(s % 60)}s`;
}
/** A countdown element the ticker keeps current. */
function countdownHTML(iso, className = '') {
  const ms = Date.parse(iso) - Date.now();
  return `<span class="cd${ms > 0 && ms < DAY_MS ? ' soon' : ''} ${className}" data-end="${esc(iso)}">${countdownText(ms)}</span>`;
}
/** A score as the API's column means it: rates kept in millionths become percentages. */
function scoreText(display, column) {
  if (display == null || display === '') return '—';
  if (column?.source?.endsWith('_micro')) {
    const n = Number(display);
    return Number.isFinite(n) ? `${(n / 10_000).toFixed(1)}%` : String(display);
  }
  return String(display);
}

/** Per-view state that outlives a visit to another route (sort, filter, scroll), keyed by route name. */
const viewState = new Map();

const main = document.getElementById('main');
let routeToken = 0;
let cleanupView = null;

function matchRoute(hash) {
  const [pathPart, query = ''] = (hash || '#/').split('?');
  for (const candidate of ROUTES) {
    const found = pathPart.match(candidate.pattern);
    if (found) return { route: candidate, params: found.slice(1).map(decodeURIComponent), query: new URLSearchParams(query) };
  }
  return null;
}

/** Renders the hash's surface; module and data load in parallel. __shotReady turns true once live data shows. */
async function route() {
  const hash = location.hash;
  if (hash && !hash.startsWith('#/')) return;
  const token = ++routeToken;
  window.__shotReady = false;
  cleanupView?.();
  cleanupView = null;
  const match = matchRoute(hash);
  const navBoard = document.getElementById('nav-board');
  if (match?.route.name === 'board') navBoard.setAttribute('aria-current', 'page');
  else navBoard.removeAttribute('aria-current');
  if (!match) {
    main.innerHTML = '<div class="notice"><h1 tabindex="-1">Page not found</h1><p><a href="#/">See the open bounties</a></p></div>';
    window.__shotReady = true;
    return;
  }
  for (const path of match.route.data(match.params)) warm(path);
  if (match.route.name === 'leaderboard') warm(apiPath.leaderboard(match.params[0]));
  main.setAttribute('aria-busy', 'true');
  if (!main.firstElementChild?.classList.contains('loading')) main.innerHTML = '<p class="loading" role="status">Loading live data…</p>';
  window.scrollTo(0, 0);
  try {
    const view = await match.route.view();
    if (token !== routeToken) return;
    const isCurrent = () => token === routeToken;
    const cleanup = await view.render(main, { params: match.params, query: match.query, isCurrent });
    if (!isCurrent()) {
      cleanup?.();
      return;
    }
    cleanupView = cleanup ?? null;
    main.querySelector('h1')?.setAttribute('tabindex', '-1');
  } catch (error) {
    if (token !== routeToken) return;
    main.innerHTML = `<div class="notice" role="alert"><h1 tabindex="-1">Could not load this page</h1><p>${esc(error.message)}</p><p><button class="btn" type="button" id="retry">Try again</button> <a class="btn btn-quiet" href="#/">All bounties</a></p></div>`;
    document.getElementById('retry').addEventListener('click', route);
  } finally {
    if (token === routeToken) {
      main.removeAttribute('aria-busy');
      window.__shotReady = true;
    }
  }
}

document.getElementById('skip').addEventListener('click', (event) => {
  event.preventDefault();
  main.focus();
});
window.addEventListener('hashchange', route);
startCountdownTicker();
prefetchOnIntent();
showNetStats();
route();
