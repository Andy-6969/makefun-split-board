// Loaded by index.html's one literal import(): the ETag-revalidating JSON cache (stale-while-revalidate, in-flight
// de-dup, a retry when make.fun says a board is still being built), the per-view request counter on the status
// line, the Refresh button and the hash router with one lazy view module per surface.
export { cachedJSON, revalidateByETag, refreshCurrentView, countViewRows, apiPath, onRevalidated, matchRoute, warmRoute, viewStats };

const FRESH_MS = 2e4;
const RETRY_LIMIT = 3;
const jsonCache = new Map();
const inFlight = new Map();
const onRevalidated = new Map();
/** What the current view cost: API requests sent, of those unchanged (304), answers from memory, rows kept and drawn. */
const viewStats = { requests: 0, notModified: 0, memory: 0, kept: 0, drawn: 0, paths: new Set() };
const apiPath = {
  board: () => '/api/competitions?status=open&activity=times',
  ended: () => '/api/competitions?status=resolved',
  bounty: (s) => `/api/competitions/${encodeURIComponent(s)}?submissions=summary`,
  leaderboard: (s) => `/api/competitions/${encodeURIComponent(s)}/leaderboard?rows=first`,
  profile: (h) => `/api/profiles/${encodeURIComponent(h)}`,
};
const ROUTES = [
  [/^#?\/?$/, () => import('./view-board.js'), () => apiPath.board()],
  [/^#\/bounty\/([^/]+)\/leaderboard$/, () => import('./view-leaderboard.js'), apiPath.leaderboard],
  [/^#\/bounty\/([^/]+)$/, () => import('./view-bounty.js'), apiPath.bounty],
  [/^#\/u\/([^/]+)$/, () => import('./view-profile.js'), apiPath.profile],
];

/** Fresh for 20 s from memory; after that the memory copy is served at once and revalidated by ETag behind it. */
function cachedJSON(path) {
  viewStats.paths.add(path);
  const hit = jsonCache.get(path);
  if (!hit) return revalidateByETag(path);
  showViewStats('memory');
  if (Date.now() - hit.at > FRESH_MS) revalidateByETag(path).catch(() => {});
  return Promise.resolve(hit.data);
}

/** One request per path at a time; cache:'no-cache' sends If-None-Match, so an unchanged answer is a 304. */
function revalidateByETag(path) {
  if (!inFlight.has(path)) inFlight.set(path, fetchWithRetry(path).finally(() => inFlight.delete(path)));
  return inFlight.get(path);
}

async function fetchWithRetry(path, attempt = 0) {
  showViewStats('requests');
  const res = await fetch('https://make.fun' + path, { cache: 'no-cache' });
  if (res.status === 503 && attempt < RETRY_LIMIT) {
    const wait = Number((await res.json().catch(() => ({}))).retry_after) || 3;
    await new Promise((done) => setTimeout(done, wait * 1000));
    return fetchWithRetry(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`make.fun answered ${res.status}`);
  const etag = res.headers.get('etag');
  const old = jsonCache.get(path);
  if (old && etag === old.etag) {
    res.body.cancel().catch(() => {});
    old.at = Date.now();
    showViewStats('notModified');
    return old.data;
  }
  const data = await res.json();
  jsonCache.set(path, { data, etag, at: Date.now() });
  if (old) onRevalidated.get(path)?.forEach((fn) => fn(data));
  return data;
}

/** Refresh: revalidates every answer this view used; changed ones patch the view in place, unchanged ones are 304s. */
function refreshCurrentView() {
  return Promise.allSettled([...viewStats.paths].map(revalidateByETag));
}

/** Row elements a view kept (updated in place) and drew (created). */
function countViewRows(kept, drawn) {
  viewStats.kept += kept;
  viewStats.drawn += drawn;
  showViewStats();
}

const net = document.getElementById('net');
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
function showViewStats(key) {
  if (key) viewStats[key]++;
  const s = viewStats;
  net.textContent = `This view: ${plural(s.requests, 'API request')} · ${s.notModified} unchanged (304) · ${s.memory} from memory · ${plural(s.kept, 'row')} kept · ${s.drawn} drawn`;
}

function matchRoute(hash) {
  const [path, query] = (hash || '#/').split('?');
  for (const [pattern, view, data] of ROUTES) {
    const m = path.match(pattern);
    if (m) return { view, data, params: m.slice(1).map(decodeURIComponent), query: new URLSearchParams(query) };
  }
}

/** Prefetch: starts the route's API answer and view module without counting it against the current view. */
function warmRoute(r) {
  const path = r.data(...r.params);
  if (!jsonCache.has(path) && !inFlight.has(path)) inFlight.set(path, fetchWithRetry(path).finally(() => inFlight.delete(path)));
  return r.view();
}

const main = document.getElementById('main');
let token = 0;
let cleanup;
async function route() {
  if (token && location.hash && !location.hash.startsWith('#/')) return main.focus();
  const mine = ++token;
  window.__shotReady = false;
  Object.assign(viewStats, { requests: 0, notModified: 0, memory: 0, kept: 0, drawn: 0, paths: new Set() });
  showViewStats();
  const r = matchRoute(location.hash);
  cleanup?.();
  cleanup = null;
  main.ariaBusy = 'true';
  try {
    if (!r) throw new Error('Page not found');
    const path = r.data(...r.params);
    if (!jsonCache.has(path)) revalidateByETag(path).catch(() => {});
    const view = await r.view();
    const done = await view.render(main, { params: r.params, query: r.query, isCurrent: () => mine === token });
    if (mine === token) cleanup = done;
    else done?.();
  } catch (error) {
    if (mine === token) {
      main.innerHTML = '<h1></h1><p><a href="#/">All bounties</a></p>';
      main.firstChild.textContent = error.message;
    }
  }
  if (mine === token) {
    main.ariaBusy = null;
    window.__shotReady = true;
  }
}

const refresh = document.getElementById('refresh');
refresh.addEventListener('click', async () => {
  refresh.disabled = true;
  await refreshCurrentView();
  refresh.disabled = false;
});
addEventListener('hashchange', route);
route();
