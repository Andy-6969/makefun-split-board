// First load: 20 s memory cache then stale-while-revalidate; cache:'no-cache' lets the browser revalidate by ETag (304).
export { cachedJSON, revalidateByETag, apiPath, onRevalidated, matchRoute, warmRoute, netStats };

const FRESH_MS = 2e4;
const jsonCache = new Map();
const inFlight = new Map();
const onRevalidated = new Map();
const netStats = { calls: 0, cached: 0, notModified: 0, bytes: 0 };
const apiPath = {
  board: () => '/api/competitions?status=open&activity=times',
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

function cachedJSON(path) {
  const hit = jsonCache.get(path);
  if (!hit) return revalidateByETag(path);
  count('cached');
  if (Date.now() - hit.at > FRESH_MS) revalidateByETag(path).catch(() => {});
  return Promise.resolve(hit.data);
}

function revalidateByETag(path) {
  if (!inFlight.has(path))
    inFlight.set(path, (async () => {
      count('calls');
      const res = await fetch('https://make.fun' + path, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`make.fun answered ${res.status}`);
      const etag = res.headers.get('etag');
      const old = jsonCache.get(path);
      if (old && etag === old.etag) {
        res.body.cancel().catch(() => {});
        old.at = Date.now();
        count('notModified');
        return old.data;
      }
      const text = await res.text();
      const data = JSON.parse(text);
      jsonCache.set(path, { data, etag, at: Date.now() });
      count('bytes', text.length);
      if (old) onRevalidated.get(path)?.forEach((fn) => fn(data));
      return data;
    })().finally(() => inFlight.delete(path)));
  return inFlight.get(path);
}

const net = document.getElementById('net');
function count(key, n = 1) {
  netStats[key] += n;
  const kb = netStats.bytes / 1024;
  net.textContent = `${netStats.calls} API call${netStats.calls === 1 ? '' : 's'} · ${netStats.cached} cached · ${netStats.notModified} × 304 · ${kb > 999 ? (kb / 1024).toFixed(1) + ' MB' : Math.round(kb) + ' KB'} JSON`;
}

function matchRoute(hash) {
  const [path, query] = (hash || '#/').split('?');
  for (const [pattern, view, data] of ROUTES) {
    const m = path.match(pattern);
    if (m) return { view, data, params: m.slice(1).map(decodeURIComponent), query: new URLSearchParams(query) };
  }
}

function warmRoute(r) {
  const path = r.data(...r.params);
  if (!jsonCache.has(path)) revalidateByETag(path).catch(() => {});
  return r.view();
}

const main = document.getElementById('main');
let token = 0;
let cleanup;
async function route() {
  if (token && location.hash && !location.hash.startsWith('#/')) return main.focus();
  const mine = ++token;
  window.__shotReady = false;
  const r = matchRoute(location.hash);
  cleanup?.();
  cleanup = null;
  main.ariaBusy = 'true';
  try {
    if (!r) throw new Error('Page not found');
    const view = await warmRoute(r);
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

addEventListener('hashchange', route);
route();
