// Shared by every view, loaded with the first view (never in the first load): the keyed in-place patch, the one
// countdown ticker that rewrites only text nodes, formatters, and the full stylesheet as a constructable sheet.
export { patchKeyedList, watchJSON, setText, fields, startCountdownTicker, countdownHTML, viewState, esc, money, count, ordinal, utcDate, dayDate, scoreText, APP_STYLES };

import { matchRoute, onRevalidated, revalidateByETag, warmRoute } from './core.js';

/** make.fun's ETags change at most once a minute: watched answers are revalidated on that beat. */
const REVALIDATE_EVERY_MS = 60e3;

/** onChange runs when a revalidation brings changed data (a 304 changes nothing); revalidates each minute while visible. */
function watchJSON(path, onChange) {
  if (!onRevalidated.has(path)) onRevalidated.set(path, new Set());
  onRevalidated.get(path).add(onChange);
  const timer = setInterval(() => document.hidden || revalidateByETag(path).catch(() => {}), REVALIDATE_EVERY_MS);
  return () => {
    clearInterval(timer);
    onRevalidated.get(path).delete(onChange);
  };
}

/** True facts about this build, from main.ts's dossier Totals line (first load) and the code. */
const BUILD_FACTS = '2-file first load (2,471 B gzip) · 4 views + shared UI by import() · ETag/304-revalidated cache · rows patched in place · virtual leaderboard';
const DAY_MS = 864e5;

/** Keyed patch: kept keys are updated in place and moved only when out of order; new keys created, gone removed. */
function patchKeyedList(parent, items, keyOf, create, update) {
  const byKey = new Map();
  for (const el of parent.children) byKey.set(el.dataset.key, el);
  let cursor = parent.firstElementChild;
  for (const item of items) {
    const key = String(keyOf(item));
    let el = byKey.get(key);
    if (el) byKey.delete(key);
    else {
      el = create(item);
      el.dataset.key = key;
    }
    update(el, item);
    if (el === cursor) cursor = cursor.nextElementSibling;
    else parent.insertBefore(el, cursor);
  }
  for (const el of byKey.values()) el.remove();
}

/** Sets text only when it differs, reusing the existing text node. */
function setText(el, value) {
  if (!el) return;
  const text = String(value);
  const node = el.firstChild;
  if (node?.nodeType === 3 && !node.nextSibling) {
    if (node.data !== text) node.data = text;
  } else if (el.textContent !== text) el.textContent = text;
}

/** The [data-f] descendants by name. */
function fields(root) {
  const found = {};
  for (const el of root.querySelectorAll('[data-f]')) found[el.dataset.f] = el;
  return found;
}

/** Per-view state kept across routes (sort, category). */
const viewState = new Map();

const countdowns = document.getElementsByClassName('cd');
/** One 1 s timer for every countdown on the page; it rewrites their text nodes and nothing else. */
function startCountdownTicker() {
  const tick = () => {
    const now = Date.now();
    for (const el of countdowns) {
      const end = Date.parse(el.dataset.end);
      setText(el, countdownText(end - now));
      el.classList.toggle('soon', end > now && end - now < DAY_MS);
    }
  };
  setInterval(tick, 1000);
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const integer = new Intl.NumberFormat('en-US');
const dateTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
const dateYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

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
  const t = n % 100;
  return count(n) + (t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
}
const utcDate = (iso) => `${dateTime.format(new Date(iso))} UTC`;
const dayDate = (iso) => dateYear.format(new Date(iso));
const pad = (n) => String(n).padStart(2, '0');
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
function countdownHTML(iso) {
  const ms = Date.parse(iso) - Date.now();
  return `<span class="cd${ms > 0 && ms < DAY_MS ? ' soon' : ''}" data-end="${esc(iso)}">${countdownText(ms)}</span>`;
}
/** A score as its column means it: rates kept in millionths become percentages. */
function scoreText(display, column) {
  if (display == null || display === '') return '—';
  const n = Number(display);
  return column?.source?.endsWith('_micro') && Number.isFinite(n) ? `${(n / 1e4).toFixed(1)}%` : String(display);
}

/** The whole stylesheet beyond the inline shell: one card, one chip, one button, one accent for money and urgency. */
const APP_STYLES = `
:root{--sunk:#f8f5ef;--ink-2:#3d3931;--line-2:#ece6db;--accent:#a63a0b;--accent-soft:#fbeee5;--r:10px;--mono:ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;color-scheme:light}
@media(prefers-color-scheme:dark){:root{--bg:#161512;--surface:#1f1d19;--ink:#f1ece2;--muted:#a99f8f;--line:#37332c;--sunk:#1a1915;--ink-2:#d9d2c4;--line-2:#2c2924;--accent:#f08a4b;--accent-soft:#3a2418;color-scheme:dark}}
h1,h2,h3,h4,p,ol,ul,dl,dd{margin:0}
ol,ul{padding:0;list-style:none}
a{text-decoration-color:color-mix(in srgb,currentColor 35%,transparent);text-underline-offset:3px}
a:hover{color:var(--accent);text-decoration-color:currentColor}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:4px}
[hidden]{display:none!important}
button,input{font:inherit;color:inherit}
.money{color:var(--accent)}
.num,.money,dd,.cd,.rank,.n{font-variant-numeric:tabular-nums}
.num{text-align:right}
.muted{color:var(--muted)}
.dim{color:var(--muted);font-size:14px}
.n{color:var(--muted);font-weight:600}
.brand b{font-weight:800}
.nav a{display:inline-flex;align-items:center;min-height:56px;font-weight:600;color:var(--ink-2);text-decoration:none;border-bottom:3px solid transparent}
.nav a[aria-current]{color:var(--ink);border-bottom-color:var(--accent)}
.facts{position:fixed;left:0;right:0;bottom:0;z-index:5;display:flex;align-items:center;justify-content:center;min-height:28px;padding:4px 16px;background:var(--surface);border-top:1px solid var(--line);font:12px/1.3 var(--mono);color:var(--muted);text-align:center}
main[aria-busy]{opacity:.6}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:14px 18px;min-width:0}
.card>h2{font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2);padding-bottom:8px;margin-bottom:4px;border-bottom:1px solid var(--line-2)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip,.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:38px;padding:0 14px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface);color:var(--ink);font-size:15px;font-weight:600;text-decoration:none;cursor:pointer}
.chip:hover,.btn:hover{border-color:var(--ink-2);color:var(--ink)}
.chip[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:var(--surface)}
.chip[aria-pressed=true] .n{color:inherit;opacity:.75}
.btn-wide{width:100%;margin-top:10px}
.pill{flex:none;padding:4px 10px;border:1.5px solid currentColor;border-radius:var(--r);font-size:12.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
.pill-live{color:var(--accent);background:var(--accent-soft)}
.pill-wait{color:var(--ink-2)}
.pill-done{color:var(--muted)}
.crumbs{font-size:14.5px;color:var(--muted)}
.crumbs a{color:var(--ink-2)}
.title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-top:4px}
.title-row h1{font-size:30px;line-height:1.2;letter-spacing:-.02em;font-weight:800;text-wrap:balance}
.tabs{display:flex;gap:20px;margin-top:8px;border-bottom:1px solid var(--line)}
.tabs a{display:inline-flex;align-items:center;gap:6px;min-height:44px;font-weight:600;color:var(--ink-2);text-decoration:none;border-bottom:3px solid transparent;margin-bottom:-1px}
.tabs a[aria-current]{color:var(--ink);border-bottom-color:var(--accent)}
.k,.headline dt,.strip dt,.record dt,.mini dt,.datesbar dt,.tbl thead th,.bhead,.lhead,.top10-head{font-size:12.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.tbl{width:100%;border-collapse:collapse;font-size:15px}
.tbl th,.tbl td{padding:7px 0;border-bottom:1px solid var(--line-2);text-align:left;vertical-align:baseline}
.tbl th+th,.tbl td+td{padding-left:12px}
.tbl .num{text-align:right;font-weight:700}
.tbl thead th,.tbl tfoot th,.tbl .num{white-space:nowrap}
.tbl tfoot .muted{font-weight:400}
.tbl tfoot th,.tbl tfoot td{border-bottom:0;font-weight:800;padding-top:9px}
.tbl tbody th{font-weight:600}
.empty{padding:20px;color:var(--muted)}

.board-head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap}
.board-head h1{font-size:36px;line-height:1.1;letter-spacing:-.025em;font-weight:800}
.lede{margin-top:6px;color:var(--muted)}
.headline{display:flex;gap:36px}
.headline dd{font-size:32px;line-height:1.1;font-weight:800;letter-spacing:-.02em}
.toolbar{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px 24px;margin:20px 0 14px}
.btable,.brows-past,.ltable{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
.bhead,.brow{display:grid;grid-template-columns:minmax(0,1fr) 150px 112px 196px 132px;gap:20px;padding:0 20px}
.bhead{padding-top:10px;padding-bottom:10px;background:var(--sunk);border-bottom:1px solid var(--line)}
.bhead span:not(:first-child){text-align:right}
.brow{position:relative;align-items:center;padding-top:13px;padding-bottom:13px;border-top:1px solid var(--line-2)}
.brow:first-child{border-top:0}
.brow:hover{background:var(--sunk)}
.c-title{min-width:0;display:grid;gap:2px}
.row-link{font-size:18px;line-height:1.3;font-weight:700;color:var(--ink);text-decoration:none;text-wrap:pretty}
.row-link::after{content:"";position:absolute;inset:0}
.row-link:focus-visible{outline:0}
.row-link:focus-visible::after{outline:3px solid var(--accent);outline-offset:-3px;border-radius:var(--r)}
.meta{font-size:14px;color:var(--muted)}
.c-num{display:grid;justify-items:end;text-align:right;line-height:1.2}
.c-num b{font-weight:800}
.c-num small{margin-top:3px;font-size:13.5px;color:var(--muted)}
.big{font-size:25px;letter-spacing:-.015em}
.mid{font-size:19px}
.k{display:none}
.cd.soon{color:var(--accent)}
.past{margin-top:24px}
.past h2{font-size:15px;font-weight:700;color:var(--ink-2);margin-bottom:10px}

.split{display:grid;grid-template-columns:360px minmax(0,1fr);gap:20px;align-items:start}
.split-list{padding:0;position:sticky;top:12px;max-height:calc(100vh - 56px);overflow:auto;overscroll-behavior:contain}
.split-list h2{display:flex;justify-content:space-between;align-items:baseline;padding:10px 14px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2);border-bottom:1px solid var(--line);background:var(--sunk)}
.split-list .brow{grid-template-columns:repeat(4,auto);justify-content:space-between;gap:2px 10px;padding:10px 14px}
.split-list .c-title{grid-column:1/-1;margin-bottom:2px}
.split-list .row-link{font-size:15.5px}
.split-list .meta,.split-list .c-num small{display:none}
.split-list .c-num{justify-items:start;text-align:left}
.split-list .big,.split-list .mid{font-size:16px}
.split-list .brow.is-selected{background:var(--accent-soft);box-shadow:inset 4px 0 var(--accent)}

.strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin-top:14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r)}
.strip>div{padding:11px 16px;border-left:1px solid var(--line-2);min-width:0}
.strip>div:first-child{border-left:0}
.strip dd{font-size:27px;line-height:1.15;font-weight:800;letter-spacing:-.02em;margin-top:2px}
.strip small{display:block;font-size:13px;color:var(--muted);margin-top:2px}
.datesbar{display:flex;flex-wrap:wrap;gap:2px 22px;margin-top:12px;padding:7px 16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);font-size:14.5px}
.datesbar div{display:flex;gap:8px;align-items:baseline}
.datesbar dd{font-weight:700}
.datesbar .muted{font-weight:400}
.cols2{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:14px;margin-top:14px;align-items:start}
.top10 li{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:8px;align-items:baseline;padding:3px 0;border-bottom:1px solid var(--line-2);font-size:15px}
.top10 .who{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top10 .who a{font-weight:700}
.top10 .who .muted{font-size:13.5px}
.top10 .num{font-weight:700}
.top10 li.muted{display:block}
.about{margin-top:14px}
.prose{font-size:16.5px;line-height:1.65}
.prose>*+*{margin-top:12px}
.prose p,.prose li{max-width:72ch}
.prose .summary{font-size:17.5px;color:var(--ink-2);margin-top:12px}
.prose h3{font-size:18px;margin-top:22px}
.prose h4{font-size:16px;margin-top:18px}
.prose ul,.prose ol{padding-left:1.3em}
.prose ul{list-style:disc}
.prose ol{list-style:decimal}
.prose code{font:.9em var(--mono);background:var(--sunk);padding:1px 4px;border-radius:4px}
.prose pre{overflow-x:auto;background:var(--sunk);padding:12px;border-radius:var(--r);font-size:14px}
.scroll-x{overflow-x:auto}
.rules{border-top:1px solid var(--line-2);padding-top:12px}
.rules summary{cursor:pointer;font-weight:700;min-height:44px;display:flex;align-items:center}
.judged{color:var(--ink-2);font-size:15px}
.tags{display:flex;flex-wrap:wrap;gap:6px}
.tag{display:inline-block;padding:2px 8px;border:1px solid var(--line);border-radius:6px;font-size:13px;color:var(--ink-2);background:var(--sunk)}

.lb-bar{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px 24px;margin:14px 0 12px}
.lb-bar>div{flex:1;min-width:0}
.lb-bar p{color:var(--ink-2)}
.lb-live{font:13px var(--mono);color:var(--muted);margin-top:4px}
.search{display:grid;gap:4px;font-size:13px;font-weight:700;color:var(--muted)}
.search input{width:300px;max-width:100%;min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface);font-size:16px;font-weight:400;color:var(--ink)}
.lhead,.lrow a{display:grid;grid-template-columns:72px minmax(0,1fr) 140px 110px;gap:16px;align-items:center;padding:0 18px}
.lhead{padding-top:10px;padding-bottom:10px;background:var(--sunk);border-bottom:1px solid var(--line)}
.vlist{position:relative}
.lrow{position:absolute;top:0;left:0;right:0;height:56px;border-bottom:1px solid var(--line-2);contain:strict}
.lrow a{height:100%;text-decoration:none;color:var(--ink)}
.lrow a:hover{background:var(--sunk)}
.lrow a:focus-visible{outline-offset:-3px}
.lrow .rank{font-weight:800;color:var(--ink-2)}
.lrow.paid .rank{color:var(--accent)}
.lrow .who{min-width:0;display:grid;grid-template-columns:auto 1fr;column-gap:8px;line-height:1.3}
.lrow .who b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:underline;text-decoration-color:var(--muted);text-underline-offset:3px}
.lrow a:hover .who b{text-decoration-color:currentColor}
.lrow .who .tag{justify-self:start;padding:0 6px;font-size:12px}
.lrow .who .muted{grid-column:1/-1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}
.lrow .num{font-weight:700}

.who-head{display:flex;align-items:center;gap:18px;margin-top:12px}
.who-head h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;font-weight:800;overflow-wrap:anywhere}
.avatar{flex:none;width:72px;height:72px;border-radius:50%;object-fit:cover;background:var(--sunk);border:1px solid var(--line)}
.avatar-none{display:grid;place-items:center;font-size:30px;font-weight:800;color:var(--accent);background:var(--accent-soft)}
.links{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:4px;font-weight:600}
.links a,.links span{display:inline-flex;align-items:center;min-height:32px}
.bio{margin-top:12px;max-width:70ch;color:var(--ink-2)}
.profile-cols{display:grid;grid-template-columns:320px minmax(0,1fr);gap:16px;margin-top:20px;align-items:start}
.profile-cols>.card:last-child:nth-child(3){grid-column:2}
.record{display:grid;grid-template-columns:1fr 1fr;background:var(--surface);border:1px solid var(--line);border-radius:var(--r)}
.record>div{padding:12px 16px;border-top:1px solid var(--line-2)}
.record>div:nth-child(-n+2){border-top:0}
.record>div:nth-child(even){border-left:1px solid var(--line-2)}
.record dd{font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-.015em}
.entry{padding:14px 0;border-bottom:1px solid var(--line-2);content-visibility:auto;contain-intrinsic-size:auto 150px}
.entry:last-child{border-bottom:0}
.entry-bounty{font-size:17px;font-weight:700}
.entry-title{color:var(--ink-2);font-size:14.5px;margin-top:2px;overflow-wrap:anywhere}
.mini{display:grid;grid-template-columns:96px 96px minmax(0,1fr);gap:6px 12px;margin-top:8px}
.mini dd{font-size:18px;font-weight:800}
.payouts li{display:grid;grid-template-columns:90px minmax(0,1fr);gap:12px;padding:10px 0;border-bottom:1px solid var(--line-2)}
.payouts li:last-child{border-bottom:0}
.payouts .dim{display:block}
.big-s{font-size:18px;font-weight:800}

@media(max-width:1080px){
.split{grid-template-columns:minmax(0,1fr)}
.split-list{display:none}
.bhead,.brow{grid-template-columns:minmax(0,1fr) 130px 96px 170px 112px;gap:14px}
}
@media(max-width:720px){
.nav a{min-height:44px}
.facts{position:static;margin-top:8px}
.board-head h1{font-size:30px}
.headline{width:100%;justify-content:space-between;gap:12px}
.headline dd{font-size:24px}
.chip,.btn{min-height:44px}
.toolbar .chips{flex-wrap:nowrap;overflow-x:auto;margin:0 -16px;padding:0 16px 2px;scrollbar-width:none}
.chip{flex:none;padding:0 12px}
.bhead{display:none}
.brow{grid-template-columns:1fr 1fr;gap:10px 14px;padding:14px 16px}
.c-title{grid-column:1/-1}
.c-num{justify-items:start;text-align:left}
.k{display:block;margin-bottom:2px}
.big{font-size:23px}
.title-row{flex-direction:column;gap:8px}
.title-row h1,.who-head h1{font-size:26px}
.strip{grid-template-columns:1fr 1fr}
.strip>div:nth-child(3){border-left:0}
.strip>div:nth-child(n+3){border-top:1px solid var(--line-2)}
.strip dd{font-size:24px}
.cols2,.profile-cols{grid-template-columns:minmax(0,1fr)}
.tbl{font-size:14px}
.tbl thead th,.tbl tfoot th{white-space:normal}
.tbl th+th,.tbl td+td{padding-left:8px}
.card{padding:12px 14px}
.profile-cols>.card:last-child:nth-child(3){grid-column:auto}
.lhead,.lrow a{grid-template-columns:52px minmax(0,1fr) 76px;gap:10px;padding:0 12px}
.lhead span:last-child,.lrow a .money{display:none}
.search,.search input{width:100%}
.avatar{width:64px;height:64px}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
`;

/** Adopted once, when the first view loads: the inline shell in index.html covers the page until then. */
const sheet = new CSSStyleSheet();
sheet.replaceSync(APP_STYLES);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
const facts = document.createElement('footer');
facts.className = 'facts';
facts.textContent = BUILD_FACTS;
document.body.append(facts);
startCountdownTicker();
const markNav = () => {
  const nav = document.getElementById('nav-board');
  if (/^#?\/?(\?|$)/.test(location.hash)) nav.setAttribute('aria-current', 'page');
  else nav.removeAttribute('aria-current');
};
addEventListener('hashchange', markNav);
markNav();

/** Prefetch on intent: 70 ms of hover, or keyboard focus, on an in-app link loads its view module and API answer. */
let hoverTimer = 0;
function prefetchOnIntent(event, delay) {
  clearTimeout(hoverTimer);
  const href = event.target.closest?.('a[href^="#/"]')?.getAttribute('href');
  const route = href && matchRoute(href);
  if (route) hoverTimer = setTimeout(() => warmRoute(route).catch(() => {}), delay);
}
addEventListener('pointerover', (e) => prefetchOnIntent(e, 70), { passive: true });
addEventListener('focusin', (e) => prefetchOnIntent(e, 0));
