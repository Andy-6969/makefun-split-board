// A bounty's full leaderboard, virtualised: some boards hold 6,000+ entries, so only the rows in view (plus a few
// either side) exist in the DOM, a fixed pool of row elements reused as you scroll, each rewriting only its text
// nodes. A search box narrows the list to matching entrants without leaving the page.
export { renderLeaderboard as render, VirtualRows, flattenStandings, ROW_HEIGHT };

import { apiPath, cachedJSON } from './core.js';
import { count, esc, fields, money, scoreText, setText } from './ui.js';

/** Every row has this height in px, so a row's position is its index times this. */
const ROW_HEIGHT = 56;
/** Rows rendered beyond each edge of the viewport. */
const OVERSCAN = 8;

/** Top entries (full objects) and the rest (slim rows) as one array of what a row shows. */
function flattenStandings(board, prizes) {
  const column = board.columns?.find((c) => c.key === board.rank_key);
  const toRow = (e, display) => ({
    rank: e.rank,
    handle: e.handle,
    title: e.title ?? '',
    score: scoreText(display, column),
    prize: e.prize_eligible !== false && prizes.get(e.prize_rank) ? money(prizes.get(e.prize_rank)) : '',
    tag: e.baseline ? 'Baseline' : e.house ? 'House' : '',
    search: `${e.handle} ${e.title ?? ''}`.toLowerCase(),
  });
  return [...(board.entries ?? []).map((e) => toRow(e, e.display?.[board.rank_key])), ...(board.rest ?? []).map((r) => toRow(r, r.display))];
}

/**
 * A window-scrolled virtual list. The host is as tall as all rows; a pool of absolutely positioned rows is
 * placed at the visible indexes, and row i always lives in pool slot i % pool size, so scrolling by one row
 * rewrites one element.
 */
class VirtualRows {
  constructor(host, create, fill, onDraw) {
    this.host = host;
    this.create = create;
    this.fill = fill;
    this.onDraw = onDraw;
    this.items = [];
    this.pool = [];
    this.frame = 0;
    this.schedule = () => {
      if (!this.frame) this.frame = requestAnimationFrame(() => this.draw());
    };
    addEventListener('scroll', this.schedule, { passive: true });
    addEventListener('resize', this.schedule, { passive: true });
  }
  setItems(items) {
    this.items = items;
    this.host.style.height = `${items.length * ROW_HEIGHT}px`;
    for (const row of this.pool) {
      row._index = -1;
      row.setAttribute('aria-setsize', String(items.length));
    }
    this.draw();
  }
  draw() {
    this.frame = 0;
    const size = Math.ceil(innerHeight / ROW_HEIGHT) + OVERSCAN * 2;
    while (this.pool.length < size) {
      const row = this.create();
      row._index = -1;
      row.setAttribute('aria-setsize', String(this.items.length));
      this.pool.push(row);
      this.host.append(row);
    }
    const top = this.host.getBoundingClientRect().top;
    const first = Math.max(0, Math.floor(-top / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(this.items.length, first + size);
    for (const row of this.pool) row._keep = false;
    for (let index = first; index < last; index++) {
      const row = this.pool[index % this.pool.length];
      row._keep = true;
      if (row._index !== index) {
        row._index = index;
        row.style.transform = `translateY(${index * ROW_HEIGHT}px)`;
        row.setAttribute('aria-posinset', String(index + 1));
        this.fill(row, this.items[index]);
      }
      row.hidden = false;
    }
    for (const row of this.pool) {
      if (row._keep) continue;
      row.hidden = true;
      row._index = -1;
    }
    const firstOnScreen = Math.max(0, Math.floor(-top / ROW_HEIGHT));
    const lastOnScreen = Math.min(this.items.length, Math.ceil((innerHeight - top) / ROW_HEIGHT));
    this.onDraw?.(firstOnScreen, lastOnScreen, this.items.length, this.pool.length);
  }
  destroy() {
    removeEventListener('scroll', this.schedule);
    removeEventListener('resize', this.schedule);
    cancelAnimationFrame(this.frame);
  }
}

function createRow() {
  const row = document.createElement('li');
  row.className = 'lrow';
  row.innerHTML = '<a data-f="link"><span class="rank" data-f="rank"></span><span class="who"><b data-f="handle"></b><span class="tag" data-f="tag"></span><span class="muted" data-f="title"></span></span><span class="num" data-f="score"></span><span class="num money" data-f="prize"></span></a>';
  row._f = fields(row);
  return row;
}

function fillRow(row, item) {
  const f = row._f;
  f.link.href = `#/u/${encodeURIComponent(item.handle)}`;
  row.classList.toggle('paid', Boolean(item.prize));
  setText(f.rank, item.rank ?? '—');
  setText(f.handle, item.handle);
  setText(f.tag, item.tag);
  f.tag.hidden = !item.tag;
  setText(f.title, item.title);
  setText(f.score, item.score);
  setText(f.prize, item.prize);
}

async function renderLeaderboard(main, { params: [slug], isCurrent }) {
  const [b, board] = await Promise.all([cachedJSON(apiPath.bounty(slug)), cachedJSON(apiPath.leaderboard(slug))]);
  if (!isCurrent()) return;
  document.title = `Leaderboard · ${b.title} · make.fun`;
  const prizes = new Map((b.rewardsNow ?? []).map((r) => [Number(r.place), Number(r.amountUsd)]));
  const all = flattenStandings(board, prizes);
  const column = board.columns?.find((c) => c.key === board.rank_key);
  const tieBreak = board.tie_break?.title;
  const bountyHref = `#/bounty/${encodeURIComponent(slug)}`;

  main.innerHTML = `
    <section class="lb" aria-labelledby="lb-title">
      <p class="crumbs"><a href="#/">All bounties</a> <span aria-hidden="true">/</span> <a href="${bountyHref}">${esc(b.title)}</a></p>
      <div class="title-row"><h1 id="lb-title" tabindex="-1">Leaderboard · ${esc(b.title)}</h1></div>
      <nav class="tabs" aria-label="This bounty"><a href="${bountyHref}">Overview</a><a href="${bountyHref}/leaderboard" aria-current="page">Leaderboard <span class="n">${count(all.length)}</span></a></nav>
      <div class="lb-bar">
        <div>
          <p>Live pot <b class="money">${money(b.potUsd ?? b.rewardAmount)}</b> · ${count(all.length)} ranked entries · ${esc(board.phase?.title ?? 'current phase')} · ranked by <b>${esc(column?.title ?? 'score')}</b>${tieBreak ? `, ties by ${esc(tieBreak)}` : ''}${board.phase?.placements_held ? ' · places provisional until the results' : ''}</p>
          <p class="lb-live" data-f="live" aria-live="off"></p>
        </div>
        <label class="search"><span>Find an entrant</span><input type="search" data-f="q" placeholder="Handle or entry title" autocomplete="off" spellcheck="false"></label>
      </div>
      <div class="ltable">
        <div class="lhead" aria-hidden="true"><span>Rank</span><span>Entrant and entry</span><span class="num">${esc(column?.title ?? 'Score')}</span><span class="num">Prize now</span></div>
        <ol class="vlist" aria-label="Standings" data-f="list"></ol>
        <p class="empty" data-f="none" hidden>No entrant matches that search.</p>
      </div>
    </section>`;

  const f = fields(main);
  // The live line is rewritten (one text node) on every draw: which rows are on screen, how many elements exist.
  const showWindow = (first, last, total, elements) =>
    setText(f.live, total ? `Rows ${count(first + 1)}–${count(Math.min(last, total))} of ${count(total)} on screen · ${elements} row elements in the page (virtual list)` : 'No rows');
  const list = new VirtualRows(f.list, createRow, fillRow, showWindow);
  list.setItems(all);
  scrollTo(0, 0);
  let timer = 0;
  f.q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = f.q.value.trim().toLowerCase();
      const matches = q ? all.filter((row) => row.search.includes(q)) : all;
      list.setItems(matches);
      f.none.hidden = matches.length > 0;
    }, 120);
  });
  return () => {
    clearTimeout(timer);
    list.destroy();
  };
}
