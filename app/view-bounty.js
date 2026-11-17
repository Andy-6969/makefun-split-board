// A bounty's page. On wide screens it is a split view: the live board list on the left (kept across bounty
// changes, its selection patched in place) and the bounty on the right: live pot, entry fee, closes in, entries,
// dates and status, the rewards table with fee shares and the top of its leaderboard. Phones get one column.
// The leaderboard answer fetched here is the same cached answer the full leaderboard view reuses.
export { renderBounty as render, renderSplitView, bountyState, rewardsTable, timelineHTML, topRows, intervalColumns, markdownToHTML };

import { apiPath, cachedJSON } from './core.js';
import { avatarHTML, count, countdownHTML, dayDate, esc, fields, money, ordinal, scoreText, setText, utcDate, watchJSON } from './ui.js';
import { mountBoardList } from './view-board.js';

/** Wide enough for the board list beside the bounty. */
const SPLIT_QUERY = '(min-width: 1081px)';
/** Leaderboard rows shown on the bounty page. */
const TOP_ROWS = 7;
/** Where "Enter" goes: the bounty's own page on make.fun (a plain link; this app never writes). */
const ENTER_URL = (slug) => `https://make.fun/bounty/${encodeURIComponent(slug)}`;
/** The split view's list, kept while the user moves from bounty to bounty. */
let split = null;

/** "Taking entries" is decided by the opening time and the deadline, not by the API's status. */
function bountyState(b, now = Date.now()) {
  if (b.status === 'resolved') return ['Resolved', 'pill-done'];
  if (b.status === 'closed') return ['Closed', 'pill-done'];
  const opensAt = b.opensAt ?? b.publishedAt;
  if (Date.parse(opensAt) > now) return [`Opens ${utcDate(opensAt)}`, 'pill-wait'];
  if (Date.parse(b.deadline) > now) return b.acceptingSubmissions === false ? ['Not taking entries', 'pill-done'] : ['Taking entries', 'pill-live'];
  return ['Past deadline · judging', 'pill-wait'];
}

/** Paid places, consecutive places paying the same folded into a range, with base and fee share when fees are paid in. */
function rewardsTable(b) {
  const source = b.rewardsNow?.length ? b.rewardsNow : Object.entries(b.rewards ?? {}).map(([place, amount]) => ({ place, baseUsd: amount, amountUsd: amount }));
  const groups = [];
  for (const r of source.map((x) => ({ place: Number(x.place), base: Number(x.baseUsd ?? x.amountUsd), fee: Number(x.feeShareUsd) || 0, amount: Number(x.amountUsd) })).sort((x, y) => x.place - y.place)) {
    const last = groups.at(-1);
    if (last && last.amount === r.amount && last.to === r.place - 1) last.to = r.place;
    else groups.push({ ...r, from: r.place, to: r.place });
  }
  if (!groups.length) return '<p class="muted">This bounty lists no paid places.</p>';
  const withFees = groups.some((g) => g.fee > 0);
  const places = groups.at(-1).to;
  const top = Math.max(...groups.map((g) => g.amount)) || 1;
  const rows = groups
    .map((g) => `<tr><th scope="row">${g.from === g.to ? ordinal(g.from) : `${ordinal(g.from)}–${ordinal(g.to)} <span class="muted">each</span>`}<i class="bar" aria-hidden="true" style="width:${Math.max(3, Math.round((g.amount / top) * 100))}%"></i></th>${withFees ? `<td class="num">${money(g.base)}</td><td class="num muted">+${money(g.fee)}</td>` : ''}<td class="num money">${money(g.amount)}</td></tr>`)
    .join('');
  return `<table class="tbl"><thead><tr><th scope="col">Place</th>${withFees ? '<th scope="col" class="num">Reward</th><th scope="col" class="num">Fee share</th>' : ''}<th scope="col" class="num">Pays now</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><th scope="row">Live pot <span class="muted">· ${count(places)} ${places === 1 ? 'place' : 'places'}</span></th>${withFees ? `<td class="num">${money(b.rewardAmount)}</td><td class="num muted" data-f="feesTotal">+${money(b.entryFeesUsd)}</td>` : ''}<td class="num money" data-f="potTotal">${money(b.potUsd ?? b.rewardAmount)}</td></tr></tfoot></table>`;
}

/**
 * The bounty's dates as a timeline: opened, deadline and results (the last phase's end, or when it resolved) placed
 * by time on one bar, the share already past filled, and a "Now" marker; each phase named under it.
 */
function timelineHTML(b, now = Date.now()) {
  const opened = Date.parse(b.opensAt ?? b.publishedAt);
  const deadline = Date.parse(b.deadline);
  const lastPhase = (b.phases ?? []).at(-1);
  const resultsISO = b.resolvedAt ?? (lastPhase && Date.parse(lastPhase.endsAt) > deadline ? lastPhase.endsAt : b.deadline);
  const results = Math.max(Date.parse(resultsISO), deadline + 1);
  const at = (t) => `${Math.min(100, Math.max(0, ((t - opened) / (results - opened)) * 100)).toFixed(2)}%`;
  const phaseNote = (p) => (p ? ` · ${esc(p.title)}, ${p.scores === 'live' ? 'scores live' : 'scores with results'}` : '');
  const [first, second] = b.phases ?? [];
  return `<section class="timeline" aria-label="Dates">
    <div class="tl-bar" aria-hidden="true">
      <span class="tl-seg tl-dev" style="left:0;width:${at(deadline)}"></span>
      <span class="tl-seg tl-fin" style="left:${at(deadline)};right:0"></span>
      <span class="tl-done" style="width:${at(now)}"></span>
      <span class="tl-tick" style="left:${at(deadline)}"></span>
      ${now > opened && now < results ? `<span class="tl-now" style="left:${at(now)}"><b>Now</b></span>` : ''}
    </div>
    <dl class="tl-labels">
      <div><dt>Opened</dt><dd>${esc(utcDate(new Date(opened).toISOString()))}</dd><small>${first ? phaseNote(first).slice(3) : 'entries open'}</small></div>
      <div><dt>Deadline</dt><dd>${esc(utcDate(b.deadline))}</dd><small>last entries</small></div>
      <div><dt>${b.resolvedAt ? 'Resolved' : 'Results'}</dt><dd>${esc(utcDate(resultsISO))}</dd><small>${second ? phaseNote(second).slice(3) : 'places final'}</small></div>
    </dl>
  </section>`;
}

/** The leaderboard's interval columns (low and high of the rank score's confidence interval), when it has them. */
function intervalColumns(board) {
  const low = board.columns?.find((c) => /interval_low/.test(c.source ?? ''));
  const high = board.columns?.find((c) => /interval_high/.test(c.source ?? ''));
  return low && high ? { low, high } : null;
}

/** The top rows of a leaderboard answer: avatar, linked handle, entry title, score with its interval. */
function topRows(board, n = TOP_ROWS) {
  const column = board.columns?.find((c) => c.key === board.rank_key);
  const interval = intervalColumns(board);
  const rows = (board.entries ?? [])
    .slice(0, n)
    .map((e) => {
      const range = interval && e.display?.[interval.low.key] != null ? `<small>${esc(scoreText(e.display[interval.low.key], interval.low))}–${esc(scoreText(e.display[interval.high.key], interval.high))}</small>` : '';
      return `<li${e.prize_eligible !== false && e.prize_rank ? ' class="paid"' : ''}><span class="rank">${e.rank ?? '—'}</span>${avatarHTML(e.image, e.handle)}<span class="who"><a href="#/u/${encodeURIComponent(e.handle)}">${esc(e.handle)}</a><span class="muted">${esc(e.title ?? '')}</span></span><span class="num">${esc(scoreText(e.display?.[board.rank_key], column))}${range}</span></li>`;
    })
    .join('');
  return { rows, column: column?.title ?? 'Score', total: (board.entries?.length ?? 0) + (board.rest?.length ?? 0) };
}

/** A small, safe Markdown subset (headings, lists, code, tables, links, bold) for descriptions and rules. */
function markdownToHTML(source) {
  const inline = (text) =>
    esc(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (_, label, href) => {
        const local = href.match(/^\/(bounty|u)\/(.+)$/);
        if (local) return `<a href="#/${local[1]}/${local[2]}">${label}</a>`;
        return `<a href="${href.startsWith('/') ? `https://make.fun${href}` : href}" rel="noopener noreferrer" target="_blank">${label}</a>`;
      });
  const out = [];
  const lines = String(source ?? '').replace(/\r/g, '').split('\n');
  let list = null;
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flush();
      const code = [];
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (/^#{1,6}\s/.test(line)) {
      flush();
      const level = Math.min(4, line.match(/^#+/)[0].length + 1);
      out.push(`<h${level}>${inline(line.replace(/^#+\s*/, ''))}</h${level}>`);
    } else if (/^\s*\|/.test(line)) {
      flush();
      const table = [];
      for (; i < lines.length && /^\s*\|/.test(lines[i]); i++) table.push(lines[i]);
      i--;
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = table.filter((row) => !/^\s*\|[\s:|-]+\|\s*$/.test(row));
      out.push(`<div class="scroll-x"><table class="tbl">${body.map((row, n) => `<tr>${cells(row).map((c) => (n === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('')}</table></div>`);
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const kind = /^\s*\d+\./.test(line) ? 'ol' : 'ul';
      if (paragraph.length || list !== kind) {
        flush();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline(line.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`);
    } else if (!line.trim()) flush();
    else if (list && /^\s{2,}/.test(line)) out[out.length - 1] = out.at(-1).replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
    else {
      if (list) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return out.join('');
}

function bountyHTML(b, slug) {
  const [stateLabel, stateClass] = bountyState(b);
  const fee = Number(b.entryFeeUsd) || 0;
  const fees = Number(b.entryFeesUsd) || 0;
  const lbHref = `#/bounty/${encodeURIComponent(slug)}/leaderboard`;
  return `
    <article class="bounty">
      <p class="crumbs"><a href="#/">All bounties</a> <span aria-hidden="true">/</span> ${esc([b.category, b.sponsor?.name && `by ${b.sponsor.name}`].filter(Boolean).join(' · '))}</p>
      <div class="title-row"><h1 tabindex="-1">${esc(b.title)}</h1><span class="pills"><span class="pill ${stateClass}" data-f="state">${esc(stateLabel)}</span>${b.category ? `<span class="pill pill-wait">${esc(b.category)}</span>` : ''}</span></div>
      <div class="head-tabs">
        <nav class="tabs" aria-label="This bounty"><a href="#/bounty/${encodeURIComponent(slug)}" aria-current="page">Overview</a><a href="${lbHref}">Leaderboard <span class="n" data-f="lbCount">${count(b.submissionCount)}</span></a></nav>
        <a class="btn btn-accent btn-enter" href="${ENTER_URL(slug)}" rel="noopener noreferrer" target="_blank">Enter on make.fun <span aria-hidden="true">↗</span></a>
      </div>
      <dl class="strip">
        <div><dt>Live pot</dt><dd class="money" data-f="pot">${money(b.potUsd ?? b.rewardAmount)}</dd><small data-f="potNote">${fees > 0 ? `${money(b.rewardAmount)} reward + ${money(fees)} fees` : 'fixed reward'}</small></div>
        <div><dt>Entry fee</dt><dd>${fee > 0 ? money(fee) : 'Free'}</dd><small data-f="feeNote">${fee > 0 ? `${count(b.entryFeePayers)} paid so far` : 'no entry fee'}</small></div>
        <div><dt>${Date.parse(b.deadline) > Date.now() ? 'Closes in' : 'Deadline'}</dt><dd>${countdownHTML(b.deadline)}</dd><small>${esc(utcDate(b.deadline))}</small></div>
        <div><dt>Entries</dt><dd data-f="entries">${count(b.submissionCount)}</dd><small data-f="passed">${b.submissionsPassed != null ? `${count(b.submissionsPassed)} passed checks` : ''}</small></div>
      </dl>
      ${timelineHTML(b)}
      <div class="cols2">
        <section class="card" aria-labelledby="rw-h"><h2 id="rw-h">Rewards</h2>${rewardsTable(b)}</section>
        <section class="card" aria-labelledby="lb-h"><h2 id="lb-h">Leaderboard</h2>
          <ol class="top10" data-f="top"><li class="muted">Loading the standings…</li></ol>
          <a class="btn btn-wide" href="${lbHref}" data-f="lbLink">Full leaderboard</a>
        </section>
      </div>
      <section class="card prose about" aria-labelledby="ab-h"><h2 id="ab-h">About this bounty</h2>
        ${b.skills?.length ? `<p class="tags">${b.skills.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</p>` : ''}
        ${b.summary ? `<p class="summary">${esc(b.summary)}</p>` : ''}
        ${b.resolution?.summary ? `<p class="judged"><strong>How it is judged.</strong> ${esc(b.resolution.summary)}</p>` : ''}
        ${markdownToHTML(b.description)}
        <p class="dim">Published ${esc(dayDate(b.publishedAt ?? b.opensAt))} · ${count(b.commentCount ?? 0)} comments on make.fun</p>
        ${b.rules ? `<details class="rules" data-f="rules"><summary>Full rules</summary><div data-f="rulesBody"></div></details>` : ''}
      </section>
    </article>`;
}

/** Keeps (or builds) the split shell: the board list stays mounted and only its selection moves. */
async function renderSplitView(main, slug) {
  if (!split?.shell.isConnected) {
    split?.list.stop();
    const shell = document.createElement('div');
    shell.className = 'split';
    shell.innerHTML = '<aside class="split-list card" aria-label="Bounties" data-f="panel"></aside><div class="split-detail" data-f="detail"></div>';
    const f = fields(shell);
    const list = await mountBoardList(f.panel, slug);
    split = { shell, list, detail: f.detail };
  }
  return split;
}

async function renderBounty(main, { params: [slug], isCurrent }) {
  const wide = matchMedia(SPLIT_QUERY).matches;
  const [b] = await Promise.all([cachedJSON(apiPath.bounty(slug)), wide ? renderSplitView(main, slug) : null]);
  if (!isCurrent()) return;
  document.title = `${b.title} · make.fun`;
  let target = main;
  if (wide) {
    if (!split.shell.isConnected) main.replaceChildren(split.shell);
    target = split.detail;
  }
  target.innerHTML = bountyHTML(b, slug);
  scrollTo(0, 0);
  split?.list.select(slug);

  const f = fields(target);
  f.rules?.addEventListener('toggle', () => {
    if (f.rules.open && !f.rulesBody.firstChild) f.rulesBody.innerHTML = markdownToHTML(b.rules);
  });
  const patchNumbers = (fresh) => {
    const feesNow = Number(fresh.entryFeesUsd) || 0;
    setText(f.pot, money(fresh.potUsd ?? fresh.rewardAmount));
    setText(f.potNote, feesNow > 0 ? `${money(fresh.rewardAmount)} reward + ${money(feesNow)} fees` : 'fixed reward');
    if (Number(fresh.entryFeeUsd) > 0) setText(f.feeNote, `${count(fresh.entryFeePayers)} paid so far`);
    setText(f.entries, count(fresh.submissionCount));
    if (fresh.submissionsPassed != null) setText(f.passed, `${count(fresh.submissionsPassed)} passed checks`);
    setText(f.potTotal, money(fresh.potUsd ?? fresh.rewardAmount));
    if (f.feesTotal) setText(f.feesTotal, `+${money(feesNow)}`);
    setText(f.state, bountyState(fresh)[0]);
  };
  const stopWatching = watchJSON(apiPath.bounty(slug), patchNumbers);
  // Called as the next route starts: the board list survives only if the next route is another bounty.
  const cleanup = () => {
    stopWatching();
    if (!/^#\/bounty\/[^/]+$/.test(location.hash.split('?')[0]) && split) {
      split.list.stop();
      split = null;
    }
  };

  if (!b.submissionCount) {
    f.top.innerHTML = '<li class="muted">No entries yet.</li>';
    return cleanup;
  }
  try {
    const board = await cachedJSON(apiPath.leaderboard(slug));
    if (!isCurrent()) return cleanup;
    const top = topRows(board);
    f.top.innerHTML = top.rows ? `<li class="top10-head" aria-hidden="true"><span>#</span><span></span><span>Entrant</span><span class="num">${esc(top.column)}</span></li>${top.rows}` : '<li class="muted">No ranked entries yet.</li>';
    setText(f.lbLink, `Full leaderboard · ${count(top.total)} ranked`);
    setText(f.lbCount, count(top.total));
  } catch (error) {
    f.top.innerHTML = `<li class="muted">The leaderboard did not load: ${esc(error.message)}</li>`;
  }
  return cleanup;
}
