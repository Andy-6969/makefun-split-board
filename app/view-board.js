// The bounty board: every live bounty with its reward or live pot, entry fee, time left and entries. Sorting,
// filtering and the minute-by-minute refresh all go through one keyed patch, so rows are moved and their text
// updated in place, never rebuilt. mountBoardList is the same list beside a bounty in the split view.
export { renderBoard as render, patchBoardRows, mountBoardList, filterAndSortRows, toBoardRow, SORTS };

import { apiPath, cachedJSON } from './core.js';
import { countdownHTML, count, fields, money, patchKeyedList, setText, shortDate, utcDate, viewState, watchJSON } from './ui.js';

/** The sort chips: label and comparator over normalised rows. */
const SORTS = {
  soon: ['Closing soon', (a, b) => a.end - b.end],
  pot: ['Largest pot', (a, b) => b.pot - a.pot || a.end - b.end],
  entries: ['Most entries', (a, b) => b.entries - a.entries || a.end - b.end],
  new: ['Newest', (a, b) => b.published - a.published || a.end - b.end],
};
/** The API lists only the latest 50 entry times per bounty, so a full hour reads "50+". */
const RECENT_TIMES_CAP = 50;
const HOUR_MS = 3_600_000;
/** A row gets the "Closing soon" badge inside this window before its deadline. */
const CLOSING_SOON_MS = 24 * HOUR_MS;
/** Ended bounties shown under the live ones in the split panel's Live tab. */
const RECENTLY_ENDED_ROWS = 4;

/** One bounty from /api/competitions as the numbers a row shows. */
function toBoardRow(item, now) {
  const recent = (item.submissions ?? []).filter((s) => now - Date.parse(s.createdAt) < HOUR_MS).length;
  const fees = Number(item.entryFeesUsd) || 0;
  return {
    slug: item.slug,
    title: item.title,
    meta: [item.category, item.sponsor?.name].filter(Boolean).join(' · '),
    category: item.category || 'Other',
    pot: Number(item.potUsd ?? item.rewardAmount) || 0,
    base: Number(item.rewardAmount) || 0,
    fees,
    fee: Number(item.entryFeeUsd) || 0,
    payers: item.entryFeePayers ?? 0,
    deadline: item.deadline,
    end: Date.parse(item.deadline),
    published: Date.parse(item.publishedAt ?? item.deadline),
    opensAt: item.opensAt ?? item.publishedAt,
    entries: item.submissionCount ?? 0,
    lastHour: recent >= RECENT_TIMES_CAP ? `${RECENT_TIMES_CAP}+` : String(recent),
    ended: item.status === 'resolved' || item.status === 'closed',
    endedAt: item.resolvedAt ?? item.deadline,
    search: `${item.title} ${item.category ?? ''} ${item.sponsor?.name ?? ''}`.toLowerCase(),
  };
}

const ROW_HTML = `
  <div class="c-title"><a class="row-link" data-f="title"></a><span class="badge" data-f="soon" hidden>Closing soon</span><span class="meta" data-f="meta"></span></div>
  <div class="c-num c-reward"><span class="k">Reward</span><b class="big money" data-f="pot"></b><small data-f="potNote"></small></div>
  <div class="c-num c-fee"><span class="k">Entry fee</span><b class="mid" data-f="fee"></b><small data-f="feeNote"></small></div>
  <div class="c-num c-time"><span class="k">Closes in</span><b class="big" data-f="time"></b><small data-f="date"></small></div>
  <div class="c-num c-entries"><span class="k">Entries</span><b class="mid" data-f="entries"></b><small data-f="pace"></small></div>`;

function createBoardRow() {
  const row = document.createElement('li');
  row.className = 'brow';
  row.innerHTML = ROW_HTML;
  row._f = fields(row);
  return row;
}

/** Writes one row's values into its existing text nodes; the countdown node is only re-pointed if the deadline moved. */
function updateBoardRow(row, b) {
  const f = row._f;
  const href = `#/bounty/${encodeURIComponent(b.slug)}`;
  if (f.title.getAttribute('href') !== href) f.title.setAttribute('href', href);
  setText(f.title, b.title);
  setText(f.meta, b.meta);
  setText(f.pot, money(b.pot));
  setText(f.potNote, b.fees > 0 ? `${money(b.base)} + ${money(b.fees)} fees` : 'fixed reward');
  setText(f.fee, b.fee > 0 ? money(b.fee) : 'Free');
  setText(f.feeNote, b.fee > 0 ? `${count(b.payers)} paid` : 'to enter');
  const now = Date.now();
  f.soon.hidden = b.ended || !(b.end > now && b.end - now < CLOSING_SOON_MS);
  if (b.ended) setText(f.time, `Ended ${shortDate(b.endedAt)}`);
  else if (f.time.firstElementChild?.dataset.end !== b.deadline) f.time.innerHTML = countdownHTML(b.deadline);
  const notOpenYet = Date.parse(b.opensAt) > now;
  setText(f.date, notOpenYet ? `opens ${utcDate(b.opensAt)}` : utcDate(b.deadline));
  setText(f.entries, count(b.entries));
  setText(f.pace, notOpenYet ? 'not open yet' : `${b.lastHour} in the last hour`);
}

/** Puts the chosen sort and category over the rows, in place. */
function patchBoardRows(view, state) {
  const now = Date.now();
  const shown = filterAndSortRows(view.rows, state.q, state.sort).filter((b) => state.cat === 'All' || b.category === state.cat);
  const open = shown.filter((b) => b.end > now);
  const past = shown.filter((b) => b.end <= now).sort((a, b) => b.end - a.end);
  patchKeyedList(view.openList, open, (b) => b.slug, createBoardRow, updateBoardRow);
  patchKeyedList(view.pastList, past, (b) => b.slug, createBoardRow, updateBoardRow);
  view.pastBlock.hidden = past.length === 0;
  view.empty.hidden = open.length > 0;
  setText(view.empty, state.q ? `No live bounty matches "${state.q}".` : state.cat === 'All' ? 'No bounty is taking entries right now.' : `No ${state.cat} bounty is taking entries right now.`);

  const live = view.rows.filter((b) => b.end > now && !(Date.parse(b.opensAt) > now));
  setText(view.stats.open, count(live.length));
  setText(view.stats.pots, money(live.reduce((sum, b) => sum + b.pot, 0)));
  setText(view.stats.entries, count(live.reduce((sum, b) => sum + b.entries, 0)));

  const categories = new Map([['All', view.rows.length]]);
  for (const b of view.rows) categories.set(b.category, (categories.get(b.category) ?? 0) + 1);
  patchKeyedList(view.catChips, [...categories].sort((a, b) => (a[0] === 'All' ? -1 : b[0] === 'All' ? 1 : a[0].localeCompare(b[0]))), ([name]) => name, createChip, (chip, [name, n]) => {
    chip.value = name;
    setText(chip._f.label, name);
    setText(chip._f.n, n);
    chip.setAttribute('aria-pressed', String(name === state.cat));
  });
  for (const chip of view.sortChips.children) chip.setAttribute('aria-pressed', String(chip.value === state.sort));
}

function createChip() {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.innerHTML = '<span data-f="label"></span> <span class="n" data-f="n"></span>';
  chip._f = fields(chip);
  return chip;
}

/** Rows whose title, category or sponsor contain the typed text, in the chosen order (ended: newest first). */
function filterAndSortRows(rows, q = '', sort = 'soon') {
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((b) => b.search.includes(needle)) : [...rows];
  return shown.sort(sort === 'soon' && shown[0]?.ended ? (a, b) => b.end - a.end : SORTS[sort][1]);
}

const LIST_HTML = `
  <div class="sl-head">
    <div class="seg" role="tablist" aria-label="Which bounties" data-f="tabs">
      <button type="button" role="tab" value="live" aria-selected="true">Live <span class="n" data-f="nLive"></span></button>
      <button type="button" role="tab" value="ended" aria-selected="false">Ended <span class="n" data-f="nEnded">…</span></button>
    </div>
    <div class="sl-tools">
      <input class="filter" type="search" data-f="q" placeholder="Filter bounties" aria-label="Filter by title, category or sponsor" autocomplete="off">
      <div class="chips" role="group" aria-label="Sort" data-f="sorts">
        <button type="button" class="chip chip-s" value="soon" aria-pressed="true">Closing</button><button type="button" class="chip chip-s" value="pot" aria-pressed="false">Pot</button><button type="button" class="chip chip-s" value="entries" aria-pressed="false">Entries</button>
      </div>
    </div>
    <div class="sl-cols" aria-hidden="true"><span>Reward</span><span>Fee</span><span data-f="timeCol">Closes in</span><span>Entries</span></div>
  </div>
  <ol class="brows" data-f="list" aria-label="Live bounties"></ol>
  <ol class="brows" data-f="endedList" aria-label="Ended bounties" hidden></ol>
  <p class="empty" data-f="none" hidden>No bounty matches.</p>
  <div data-f="recent" hidden><h3 class="sl-sub">Recently ended</h3><ol class="brows" data-f="recentList" aria-label="Recently ended bounties"></ol></div>`;

/**
 * The board as a compact list panel beside a bounty (split view on wide screens): Live / Ended tabs with counts, a
 * type-to-filter box and sort chips, the selected bounty marked. Every change is the same keyed patch, so rows are
 * kept and moved, never rebuilt. Ended bounties load after the live list has drawn. select() moves the mark in place.
 */
async function mountBoardList(panel, selected) {
  panel.innerHTML = LIST_HTML;
  const f = fields(panel);
  const state = { tab: 'live', q: '', sort: 'soon' };
  let live = [];
  let ended = null;
  const draw = () => {
    const now = Date.now();
    // Each tab keeps its own list, so switching tabs hides one and shows the other without rebuilding either.
    const list = state.tab === 'live' ? f.list : f.endedList;
    const rows = filterAndSortRows(state.tab === 'live' ? live.filter((b) => b.end > now) : ended ?? [], state.q, state.sort);
    patchKeyedList(list, rows, (b) => b.slug, createBoardRow, (row, b) => {
      updateBoardRow(row, b);
      const isSelected = b.slug === selected;
      row.classList.toggle('is-selected', isSelected);
      if (isSelected) row._f.title.setAttribute('aria-current', 'page');
      else row._f.title.removeAttribute('aria-current');
    });
    f.list.hidden = list !== f.list;
    f.endedList.hidden = list !== f.endedList;
    setText(f.nLive, count(live.filter((b) => b.end > now).length));
    if (ended) setText(f.nEnded, count(ended.length));
    setText(f.timeCol, state.tab === 'live' ? 'Closes in' : 'Ended');
    f.none.hidden = rows.length > 0;
    const recent = state.tab === 'live' && !state.q && ended ? filterAndSortRows(ended, '', 'soon').slice(0, RECENTLY_ENDED_ROWS) : [];
    patchKeyedList(f.recentList, recent, (b) => b.slug, createBoardRow, updateBoardRow);
    f.recent.hidden = recent.length === 0;
    for (const tab of f.tabs.children) tab.setAttribute('aria-selected', String(tab.value === state.tab));
    for (const chip of f.sorts.children) chip.setAttribute('aria-pressed', String(chip.value === state.sort));
  };
  const toRows = (answer) => {
    const now = Date.now();
    return answer.items.map((item) => toBoardRow(item, now));
  };
  const loadLive = (answer) => {
    live = toRows(answer);
    draw();
  };
  const loadEnded = (answer) => {
    ended = toRows(answer);
    draw();
  };
  const pick = (key) => (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    state[key] = button.value;
    draw();
  };
  f.tabs.addEventListener('click', pick('tab'));
  f.sorts.addEventListener('click', pick('sort'));
  f.q.addEventListener('input', () => {
    state.q = f.q.value;
    draw();
  });
  loadLive(await cachedJSON(apiPath.board()));
  const endedReady = cachedJSON(apiPath.ended()).then(loadEnded, () => setText(f.nEnded, '—'));
  const stops = [watchJSON(apiPath.board(), loadLive), watchJSON(apiPath.ended(), loadEnded)];
  const regroup = setInterval(draw, 60_000);
  return {
    endedReady,
    select(slug) {
      selected = slug;
      draw();
      panel.querySelector('.brows:not([hidden]) .is-selected')?.scrollIntoView({ block: 'nearest' });
    },
    stop() {
      stops.forEach((stop) => stop());
      clearInterval(regroup);
    },
  };
}

/** Keeps sort and category in the address, without a hashchange (so nothing re-routes). */
function writeState(state) {
  const query = new URLSearchParams();
  if (state.sort !== 'soon') query.set('sort', state.sort);
  if (state.cat !== 'All') query.set('cat', state.cat);
  const hash = `#/${query.size ? `?${query}` : ''}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

async function renderBoard(main, { query, isCurrent }) {
  const remembered = viewState.get('board') ?? {};
  const state = {
    sort: SORTS[query.get('sort')] ? query.get('sort') : remembered.sort ?? 'soon',
    cat: query.get('cat') ?? remembered.cat ?? 'All',
    q: remembered.q ?? '',
  };
  const data = await cachedJSON(apiPath.board());
  if (!isCurrent()) return;
  document.title = 'Open bounties · make.fun';

  main.innerHTML = `
    <section class="board" aria-labelledby="board-h">
      <div class="board-head">
        <div>
          <h1 id="board-h">Open bounties</h1>
          <p class="lede">Build, forecast or trade for a reward. Live from make.fun, refreshed each minute.</p>
        </div>
        <dl class="headline">
          <div><dt>Taking entries</dt><dd data-f="open"></dd></div>
          <div><dt>In live pots</dt><dd class="money" data-f="pots"></dd></div>
          <div><dt>Entries so far</dt><dd data-f="entries"></dd></div>
        </dl>
      </div>
      <div class="toolbar">
        <div class="chips" role="group" aria-label="Sort bounties" data-f="sortChips">
          ${Object.entries(SORTS).map(([key, [label]]) => `<button type="button" class="chip" value="${key}">${label}</button>`).join('')}
        </div>
        <div class="chips" role="group" aria-label="Filter by category" data-f="catChips"></div>
        <input class="filter filter-board" type="search" data-f="q" placeholder="Filter by title, category or sponsor" aria-label="Filter bounties" autocomplete="off">
      </div>
      <div class="btable">
        <div class="bhead" aria-hidden="true"><span>Bounty</span><span>Reward</span><span>Entry fee</span><span>Closes in</span><span>Entries</span></div>
        <ol class="brows" data-f="openList" aria-label="Bounties taking entries"></ol>
        <p class="empty" data-f="empty" hidden></p>
      </div>
      <div class="past" data-f="pastBlock" hidden>
        <h2>Past the deadline, results pending</h2>
        <ol class="brows brows-past" data-f="pastList" aria-label="Bounties past their deadline"></ol>
      </div>
    </section>`;

  const f = fields(main);
  const view = { rows: [], openList: f.openList, pastList: f.pastList, pastBlock: f.pastBlock, empty: f.empty, sortChips: f.sortChips, catChips: f.catChips, stats: f };
  const load = (answer) => {
    const now = Date.now();
    view.rows = answer.items.map((item) => toBoardRow(item, now));
    patchBoardRows(view, state);
  };
  const choose = (change) => {
    Object.assign(state, change);
    viewState.set('board', { ...state });
    writeState(state);
    patchBoardRows(view, state);
  };
  f.sortChips.addEventListener('click', (event) => {
    const chip = event.target.closest('button');
    if (chip) choose({ sort: chip.value });
  });
  f.catChips.addEventListener('click', (event) => {
    const chip = event.target.closest('button');
    if (chip) choose({ cat: chip.value });
  });
  f.q.value = state.q;
  f.q.addEventListener('input', () => choose({ q: f.q.value }));
  load(data);
  writeState(state);
  scrollTo(0, 0);

  // A row whose deadline passes moves to the past list on the next minute's patch.
  const stopWatching = watchJSON(apiPath.board(), load);
  const regroup = setInterval(() => patchBoardRows(view, state), 60_000);
  return () => {
    stopWatching();
    clearInterval(regroup);
  };
}
