// The bounty board: every live bounty with its reward or live pot, entry fee, time left and entries. Sorting,
// filtering and the minute-by-minute refresh all go through one keyed patch, so rows are moved and their text
// updated in place, never rebuilt. mountBoardList is the same list beside a bounty in the split view.
export { renderBoard as render, patchBoardRows, mountBoardList, toBoardRow, SORTS };

import { apiPath, cachedJSON } from './core.js';
import { countdownHTML, count, fields, money, patchKeyedList, setText, utcDate, viewState, watchJSON } from './ui.js';

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
  };
}

const ROW_HTML = `
  <div class="c-title"><a class="row-link" data-f="title"></a><span class="meta" data-f="meta"></span></div>
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
  if (f.time.firstElementChild?.dataset.end !== b.deadline) f.time.innerHTML = countdownHTML(b.deadline);
  const notOpenYet = Date.parse(b.opensAt) > Date.now();
  setText(f.date, notOpenYet ? `opens ${utcDate(b.opensAt)}` : utcDate(b.deadline));
  setText(f.entries, count(b.entries));
  setText(f.pace, notOpenYet ? 'not open yet' : `${b.lastHour} in the last hour`);
}

/** Puts the chosen sort and category over the rows, in place. */
function patchBoardRows(view, state) {
  const now = Date.now();
  const shown = view.rows.filter((b) => state.cat === 'All' || b.category === state.cat).sort(SORTS[state.sort][1]);
  const open = shown.filter((b) => b.end > now);
  const past = shown.filter((b) => b.end <= now).sort((a, b) => b.end - a.end);
  patchKeyedList(view.openList, open, (b) => b.slug, createBoardRow, updateBoardRow);
  patchKeyedList(view.pastList, past, (b) => b.slug, createBoardRow, updateBoardRow);
  view.pastBlock.hidden = past.length === 0;
  view.empty.hidden = open.length > 0;
  setText(view.empty, state.cat === 'All' ? 'No bounty is taking entries right now.' : `No ${state.cat} bounty is taking entries right now.`);

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

/**
 * The board as a compact list beside a bounty (split view on wide screens): bounties before their deadline,
 * closing soonest first, the selected one marked. select() moves the mark in place; stop() ends the watch.
 */
async function mountBoardList(list, selected) {
  let rows = [];
  const draw = () => {
    const now = Date.now();
    const open = rows.filter((b) => b.end > now).sort(SORTS.soon[1]);
    patchKeyedList(list, open, (b) => b.slug, createBoardRow, (row, b) => {
      updateBoardRow(row, b);
      const isSelected = b.slug === selected;
      row.classList.toggle('is-selected', isSelected);
      if (isSelected) row._f.title.setAttribute('aria-current', 'page');
      else row._f.title.removeAttribute('aria-current');
    });
    return open.length;
  };
  const load = (answer) => {
    const now = Date.now();
    rows = answer.items.map((item) => toBoardRow(item, now));
    return draw();
  };
  const shown = load(await cachedJSON(apiPath.board()));
  const stop = watchJSON(apiPath.board(), load);
  return {
    shown,
    select(slug) {
      selected = slug;
      draw();
      list.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
    },
    stop,
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
