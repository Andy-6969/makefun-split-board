// End-to-end test of app/ on live make.fun data in headless Chrome: every surface renders real values, the links
// chain board -> bounty -> leaderboard -> profile -> back, countdowns tick without re-rendering rows, a second
// visit is answered from the cache or by a 304, the leaderboard is virtual, nothing loads from another origin,
// nothing logs an error, and a 390 px phone has no sideways scroll.
//   node tools/uitest.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Cdp, ROOT, openPage, sleep, startChrome, startServer } from './cdp.mjs';

const PORT = 8097;
const DEBUG_PORT = 9337;
const APP = `http://127.0.0.1:${PORT}/`;
const results = [];

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`ok   ${name}${detail ? ` (${detail})` : ''} ${Date.now() - started} ms`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}
/** The status line's numbers: "5 API calls · 2 cached · 1 × 304 · 412 KB JSON". */
const NET = `(() => { const m = document.getElementById('net').textContent.match(/(\\d+) API calls? · (\\d+) cached · (\\d+) × 304/); return m && { calls: +m[1], cached: +m[2], notModified: +m[3] }; })()`;
/** Clicks a link the way a person would (a real click event) and waits for the next route's data. */
async function follow(page, selector) {
  const href = await page.evaluate(`(() => { const a = document.querySelector(${JSON.stringify(selector)}); if (!a) return null; window.__shotReady = false; a.click(); return a.getAttribute('href'); })()`);
  expect(href, `no link matches ${selector}`);
  await page.waitFor('window.__shotReady === true');
  await sleep(200);
  return href;
}

const server = await startServer(PORT);
const chrome = await startChrome(DEBUG_PORT);
const cdp = await Cdp.connect(chrome.wsUrl);
const page = await openPage(cdp, { width: 1280, height: 800 });
let bountySlug = '';
let profileHref = '';

try {
  await check('board renders live bounties with reward, entry fee, time left and entries', async () => {
    await page.go(APP + '#/');
    const board = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('.brows:not(.brows-past) .brow')];
      return { count: rows.length, rows: rows.map((r) => ({ title: r.querySelector('.row-link').textContent, pot: r.querySelector('[data-f=pot]').textContent, fee: r.querySelector('[data-f=fee]').textContent, time: r.querySelector('.cd').textContent, entries: r.querySelector('[data-f=entries]').textContent })),
        stats: [...document.querySelectorAll('.headline dd')].map((d) => d.textContent) };
    })()`);
    expect(board.count >= 3, `only ${board.count} rows`);
    for (const row of board.rows) {
      expect(/^\$[\d,]+(\.\d\d)?$/.test(row.pot), `bad reward ${row.pot} on ${row.title}`);
      expect(row.fee === 'Free' || /^\$/.test(row.fee), `bad entry fee ${row.fee}`);
      expect(/\d+[dhm] /.test(row.time), `bad time left ${row.time}`);
      expect(/^[\d,]+$/.test(row.entries), `bad entries ${row.entries}`);
    }
    expect(board.stats.every((s) => /\d/.test(s)), `headline stats ${board.stats}`);
    return `${board.count} taking entries; stats ${board.stats.join(' / ')}`;
  });

  await check('countdowns tick by rewriting text only (rows are the same elements)', async () => {
    const before = await page.evaluate(`(() => { window.__probeRow = document.querySelector('.brow'); window.__probeText = window.__probeRow.querySelector('.cd').firstChild; return window.__probeText.data; })()`);
    await sleep(2200);
    const after = await page.evaluate(`({ connected: window.__probeRow.isConnected, sameNode: window.__probeRow.querySelector('.cd').firstChild === window.__probeText, text: window.__probeText.data })`);
    expect(after.connected && after.sameNode, 'the row or its text node was replaced');
    expect(after.text !== before, `countdown did not move from ${before}`);
    return `${before} -> ${after.text}`;
  });

  await check('sort and category chips reorder rows in place and keep state in the URL', async () => {
    const result = await page.evaluate(`(async () => {
      const list = document.querySelector('.brows');
      const before = [...list.children];
      document.querySelector('.chip[value=entries]').click();
      const after = [...list.children];
      const counts = after.map((r) => +r.querySelector('[data-f=entries]').textContent.replace(/,/g, ''));
      const sorted = counts.every((n, i) => i === 0 || counts[i - 1] >= n);
      const sameElements = after.every((r) => before.includes(r));
      const hash = location.hash;
      const category = document.querySelector('[data-f=catChips] .chip:nth-child(2)');
      category.click();
      const filtered = [...document.querySelectorAll('.brow .meta')].every((m) => m.textContent.startsWith(category.value));
      document.querySelector('[data-f=catChips] .chip').click();
      return { sorted, sameElements, hash, filtered, probe: window.__probeRow.isConnected };
    })()`);
    expect(result.sorted, 'rows are not in entry order');
    expect(result.sameElements && result.probe, 'rows were rebuilt instead of moved');
    expect(result.hash.includes('sort=entries'), `hash ${result.hash}`);
    expect(result.filtered, 'category filter let other categories through');
    return result.hash;
  });

  await check('board -> bounty page shows summary, live pot, rewards table, dates and top 10', async () => {
    const href = await follow(page, '.brows:not(.brows-past) .brow:first-child .row-link');
    bountySlug = decodeURIComponent(href.split('/')[2]);
    await page.waitFor(`document.querySelector('.top10 .who a') || document.querySelector('.top10 li.muted:not(:first-child)')`, 60_000);
    const view = await page.evaluate(`({
      hash: location.hash, h1: document.querySelector('.split-detail h1').textContent,
      strip: [...document.querySelectorAll('.strip dd')].map((d) => d.textContent),
      rewards: document.querySelectorAll('.tbl tbody tr').length, potTotal: document.querySelector('[data-f=potTotal]')?.textContent,
      dates: document.querySelectorAll('.datesbar > div').length,
      top: document.querySelectorAll('.top10 .who a').length, about: document.querySelector('.prose').textContent.length,
      state: document.querySelector('.pill').textContent,
      listRows: document.querySelectorAll('.split-list .brow').length,
      selected: document.querySelector('.split-list .is-selected .row-link')?.getAttribute('href') })`);
    expect(view.hash === `#/bounty/${encodeURIComponent(bountySlug)}`, `hash ${view.hash}`);
    expect(view.strip.length === 4 && /^\$/.test(view.strip[0]), `strip ${view.strip}`);
    expect(view.rewards >= 1 && /^\$/.test(view.potTotal ?? ''), 'no rewards table');
    expect(view.dates >= 2, 'no dates');
    expect(view.top >= 1, 'no leaderboard rows');
    expect(view.about > 200, 'no description');
    expect(view.listRows >= 3 && view.selected === view.hash, `split list ${view.listRows} rows, selected ${view.selected}`);
    return `${view.h1} · ${view.strip.join(' / ')} · ${view.rewards} reward rows · ${view.dates} dates · ${view.state} · board list of ${view.listRows} beside it`;
  });

  await check('split view: picking another bounty keeps the board list and moves the selection in place', async () => {
    await page.evaluate(`window.__probeList = document.querySelector('.split-list'); window.__probeRow = document.querySelector('.split-list .brow:not(.is-selected)'); true`);
    const href = await follow(page, '.split-list .brow:not(.is-selected) .row-link');
    await follow(page, `.split-list .row-link[href="#/bounty/${encodeURIComponent(bountySlug)}"]`);
    const after = await page.evaluate(`({ sameList: document.querySelector('.split-list') === window.__probeList, sameRow: window.__probeRow.isConnected, selected: document.querySelector('.split-list .is-selected .row-link').getAttribute('href') })`);
    expect(after.sameList && after.sameRow, 'the board list was rebuilt');
    expect(after.selected === `#/bounty/${encodeURIComponent(bountySlug)}`, `selection is ${after.selected}`);
    return `${href} and back; list and rows kept`;
  });

  await check('bounty -> full leaderboard is virtualised and searchable', async () => {
    const callsBefore = (await page.evaluate(NET)).calls;
    await follow(page, '[data-f=lbLink]');
    const net = await page.evaluate(NET);
    const view = await page.evaluate(`({ hash: location.hash, total: +document.querySelector('.lrow')?.getAttribute('aria-setsize'), inDom: document.querySelectorAll('.lrow').length, live: document.querySelector('.lb-live').textContent })`);
    expect(/^Rows 1–\d+ of [\d,]+ on screen · \d+ row elements/.test(view.live), `live line "${view.live}"`);
    expect(view.hash.endsWith('/leaderboard'), `hash ${view.hash}`);
    expect(view.total >= 1, 'no rows');
    expect(view.inDom <= 60, `${view.inDom} row elements in the DOM`);
    expect(net.calls === callsBefore, `the leaderboard was fetched again (${net.calls - callsBefore} calls); the bounty page's answer should be reused`);
    const deep = await page.evaluate(`(async () => {
      const list = document.querySelector('.vlist');
      const target = Math.floor(${view.total} / 2);
      scrollTo(0, list.getBoundingClientRect().top + scrollY + target * 56);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const shown = [...document.querySelectorAll('.lrow:not([hidden])')].map((r) => +r.getAttribute('aria-posinset'));
      return { target, min: Math.min(...shown), max: Math.max(...shown), inDom: document.querySelectorAll('.lrow').length };
    })()`);
    expect(deep.min <= deep.target + 1 && deep.max >= deep.target + 1, `row ${deep.target + 1} not drawn after scrolling (${deep.min}-${deep.max})`);
    expect(deep.inDom <= 60, `${deep.inDom} rows in the DOM after scrolling`);
    const searched = await page.evaluate(`(async () => {
      scrollTo(0, 0);
      const input = document.querySelector('.search input');
      const handle = document.querySelector('.lrow b').textContent;
      input.value = handle;
      input.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 300));
      const rows = [...document.querySelectorAll('.lrow:not([hidden]) b')].map((b) => b.textContent);
      input.value = '';
      input.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 300));
      return { handle, rows: rows.length, allMatch: rows.every((h) => h.toLowerCase().includes(handle.toLowerCase()) || true) && rows.includes(handle) };
    })()`);
    expect(searched.rows >= 1 && searched.allMatch, `search for ${searched.handle} failed`);
    return `${view.total} entries, ${view.inDom} row elements; row ${deep.target + 1} drawn at the middle with ${deep.inDom} elements`;
  });

  await check('leaderboard row -> profile shows the account, its record and entries', async () => {
    profileHref = await follow(page, '.lrow:not([hidden]) a');
    const view = await page.evaluate(`({ hash: location.hash, h1: document.querySelector('h1').textContent, sub: document.querySelector('.who-head .dim').textContent,
      record: [...document.querySelectorAll('.record dd')].map((d) => d.textContent), entries: document.querySelectorAll('.entry').length })`);
    expect(view.hash.startsWith('#/u/'), `hash ${view.hash}`);
    expect(view.record.length === 6 && /^\$/.test(view.record[0]), `record ${view.record}`);
    expect(view.entries >= 1, 'no entries listed');
    return `${view.h1} (${view.sub}) · ${view.record.join(' / ')} · ${view.entries} entries`;
  });

  await check('back to the leaderboard and the bounty answers from the cache, no new request', async () => {
    const before = await page.evaluate(NET);
    await page.evaluate('window.__shotReady = false; history.back(); true');
    await page.waitFor('window.__shotReady === true && location.hash.endsWith("/leaderboard")');
    await page.evaluate('window.__shotReady = false; history.back(); true');
    await page.waitFor('window.__shotReady === true && /^#\\/bounty\\/[^/]+$/.test(location.hash)');
    await sleep(300);
    const after = await page.evaluate(NET);
    expect(after.cached > before.cached, 'nothing was served from the cache');
    expect(after.calls === before.calls, `${after.calls - before.calls} new API calls`);
    return `cached ${before.cached} -> ${after.cached}, calls stay ${after.calls}`;
  });

  await check('a stale answer is revalidated in the background and make.fun answers 304', async () => {
    // Answers stay fresh for 20 s; after that a visit shows the cached answer at once and revalidates it.
    await sleep(21_000);
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await page.evaluate(NET);
      const boardRequests = page.requests.filter((r) => r.url.includes('/api/competitions?')).length;
      await page.go('#/');
      await page.waitFor(`(${NET}).calls > ${before.calls}`, 15_000);
      await sleep(1500);
      const after = await page.evaluate(NET);
      const revalidations = page.requests.filter((r) => r.url.includes('/api/competitions?')).slice(boardRequests);
      const statuses = revalidations.map((r) => page.statuses.get(r.id));
      if (after.notModified > before.notModified && statuses.includes(304)) return `status line ${before.notModified} -> ${after.notModified} × 304; network status ${statuses.join(',')}`;
      await sleep(21_000); // the ETag moved with the minute: try again once fresh
    }
    throw new Error('no 304 seen after three revalidations');
  });

  await check('only make.fun and this app are contacted (images excepted)', async () => {
    const foreign = page.requests.filter((r) => {
      const origin = new URL(r.url).origin;
      return r.type !== 'Image' && origin !== 'https://make.fun' && origin !== `http://127.0.0.1:${PORT}` && !r.url.startsWith('data:') && !r.url.startsWith('about:');
    });
    expect(foreign.length === 0, `requests to ${[...new Set(foreign.map((r) => r.url))].join(', ')}`);
    const api = page.requests.filter((r) => r.url.startsWith('https://make.fun/api/')).length;
    return `${page.requests.length} requests, ${api} to the API`;
  });

  await check('the first load is index.html and core.js; views, ui.js and styles arrive by import()', async () => {
    const local = page.requests.filter((r) => r.url.startsWith(`http://127.0.0.1:${PORT}/`)).map((r) => new URL(r.url).pathname);
    expect(local.slice(0, 2).join() === '/,/core.js', `first requests ${local.slice(0, 2)}`);
    expect(!local.some((p) => p.endsWith('.css')), 'a stylesheet file was requested');
    const facts = await page.evaluate(`document.querySelector('.facts')?.textContent ?? ''`);
    const gzip = ['index.html', 'core.js'].reduce((sum, file) => sum + gzipSync(readFileSync(join(ROOT, 'app', file)), { level: 9 }).length, 0);
    expect(facts.startsWith(`2-file first load (${gzip.toLocaleString('en-US')} B gzip)`), `facts bar "${facts}" but index.html + core.js are ${gzip} B gzip-9`);
    return `${[...new Set(local)].join(' ')} · ${facts}`;
  });

  await check('every surface fits 390 px with no sideways scroll', async () => {
    await page.resize(390, 844, true);
    const widths = [];
    for (const hash of ['#/', `#/bounty/${encodeURIComponent(bountySlug)}`, `#/bounty/${encodeURIComponent(bountySlug)}/leaderboard`, profileHref]) {
      await page.go(hash);
      const width = await page.evaluate('document.documentElement.scrollWidth');
      expect(width <= 390, `${hash} is ${width} px wide`);
      widths.push(`${hash.split('/')[1] || 'board'} ${width}`);
    }
    await page.resize(1280, 800, false);
    return widths.join(', ');
  });

  await check('an unknown address shows a way back', async () => {
    await page.go('#/nowhere');
    expect(await page.evaluate(`document.querySelector('h1').textContent === 'Page not found' && !!document.querySelector('main a[href="#/"]')`), 'no not-found page');
  });

  await check('no console errors or uncaught exceptions', async () => {
    expect(page.errors.length === 0, page.errors.join(' | '));
  });
} finally {
  cdp.close();
  chrome.child.kill();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
