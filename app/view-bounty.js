// A bounty's page: the four headline numbers, the rewards table with the live pot, the dates and phases, the top of
// its leaderboard and its description and rules. The bounty answer paints first; the (large) leaderboard answer
// fills the top-10 card after, and is the same cached answer the full leaderboard view then reuses.
export { renderBounty as render, bountyState, rewardRows, phaseList, topTenRows, markdownToHTML };

import { apiPath, cachedJSON, count, countdownHTML, dayDate, esc, fields, money, ordinal, scoreText, setText, utcDate, watchJSON } from './core.js';

/** "Taking entries" is decided by the deadline, not the status: an open bounty past its deadline is being judged. */
function bountyState(b, now = Date.now()) {
  const end = Date.parse(b.deadline);
  if (b.status === 'resolved') return ['Resolved', 'pill-done'];
  if (b.status === 'closed') return ['Closed', 'pill-done'];
  const opens = Date.parse(b.opensAt ?? b.publishedAt);
  if (opens > now) return [`Opens ${utcDate(b.opensAt ?? b.publishedAt)}`, 'pill-wait'];
  if (end > now && b.acceptingSubmissions !== false) return ['Taking entries', 'pill-live'];
  if (end > now) return ['Not taking entries', 'pill-done'];
  return ['Past deadline · judging', 'pill-wait'];
}

/** The places that pay, with consecutive places paying the same amount folded into one range ("4th–10th each"). */
function rewardRows(b) {
  const now = (b.rewardsNow?.length ? b.rewardsNow : Object.entries(b.rewards ?? {}).map(([place, amount]) => ({ place: Number(place), amountUsd: amount, feeShareUsd: 0 })))
    .map((r) => ({ place: Number(r.place), amount: Number(r.amountUsd), fee: Number(r.feeShareUsd) || 0 }))
    .sort((x, y) => x.place - y.place);
  const groups = [];
  for (const r of now) {
    const last = groups.at(-1);
    if (last && last.amount === r.amount && last.to === r.place - 1) last.to = r.place;
    else groups.push({ from: r.place, to: r.place, amount: r.amount, fee: r.fee });
  }
  return groups;
}

function rewardsCard(b) {
  const groups = rewardRows(b);
  if (!groups.length) return '<p class="muted">This bounty lists no paid places.</p>';
  const places = groups.at(-1).to;
  const rows = groups
    .map((g) => {
      const label = g.from === g.to ? ordinal(g.from) : `${ordinal(g.from)}–${ordinal(g.to)} <span class="muted">each</span>`;
      const note = g.fee > 0 ? `<small>incl. ${money(g.fee)} from fees</small>` : '';
      return `<tr><th scope="row">${label}</th><td class="num money">${money(g.amount)}${note}</td></tr>`;
    })
    .join('');
  return `<table class="tbl"><thead><tr><th scope="col">Place</th><th scope="col" class="num">Prize now</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><th scope="row">Live pot over ${count(places)} ${places === 1 ? 'place' : 'places'}</th><td class="num money" data-f="potTotal">${money(b.potUsd ?? b.rewardAmount)}</td></tr></tfoot></table>`;
}

/** The entry window and each phase's dates. */
function phaseList(b) {
  const phases = (b.phases ?? [])
    .map(
      (p) => `<li><b>${esc(p.title)}</b> <span class="muted">· ${p.scores === 'live' ? 'scores live' : 'scores with the results'}</span>
        <span class="dim">${esc(utcDate(p.startsAt))} → ${esc(utcDate(p.endsAt))}</span></li>`,
    )
    .join('');
  return `<dl class="kv">
      <div><dt>Opens</dt><dd>${esc(utcDate(b.opensAt ?? b.publishedAt))}</dd></div>
      <div><dt>Deadline</dt><dd>${esc(utcDate(b.deadline))}</dd></div>
      ${b.resolvedAt ? `<div><dt>Resolved</dt><dd>${esc(utcDate(b.resolvedAt))}</dd></div>` : ''}
    </dl>${phases ? `<ol class="phases">${phases}</ol>` : ''}`;
}

/** The first ten rows of a leaderboard answer, linking each entrant to their profile. */
function topTenRows(board) {
  const column = board.columns?.find((c) => c.key === board.rank_key);
  const rows = (board.entries ?? [])
    .slice(0, 10)
    .map(
      (e) => `<li><span class="rank">${e.rank ?? '—'}</span>
        <span class="who"><a href="#/u/${encodeURIComponent(e.handle)}">${esc(e.handle)}</a> <span class="muted">${esc(e.title ?? '')}</span></span>
        <span class="num">${esc(scoreText(e.display?.[board.rank_key], column))}</span></li>`,
    )
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
      out.push(`<div class="scroll-x"><table class="tbl tbl-md">${body.map((row, n) => `<tr>${cells(row).map((c) => (n === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('')}</table></div>`);
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

async function renderBounty(main, { params: [slug], isCurrent }) {
  const b = await cachedJSON(apiPath.bounty(slug));
  if (!isCurrent()) return;
  document.title = `${b.title} · make.fun`;
  const [stateLabel, stateClass] = bountyState(b);
  const fee = Number(b.entryFeeUsd) || 0;
  const fees = Number(b.entryFeesUsd) || 0;
  const lbHref = `#/bounty/${encodeURIComponent(slug)}/leaderboard`;

  main.innerHTML = `
    <article class="bounty">
      <header class="page-head">
        <p class="crumbs"><a href="#/">All bounties</a> <span aria-hidden="true">/</span> <span>${esc([b.category, b.sponsor?.name && `by ${b.sponsor.name}`].filter(Boolean).join(' · '))}</span></p>
        <div class="title-row"><h1>${esc(b.title)}</h1><span class="pill ${stateClass}" data-f="state">${stateLabel}</span></div>
        <nav class="tabs" aria-label="This bounty"><a href="#/bounty/${encodeURIComponent(slug)}" aria-current="page">Overview</a><a href="${lbHref}">Leaderboard <span class="n" data-f="lbCount">${count(b.submissionCount)}</span></a></nav>
      </header>
      <dl class="strip">
        <div><dt>Live pot</dt><dd class="money" data-f="pot">${money(b.potUsd ?? b.rewardAmount)}</dd><small data-f="potNote">${fees > 0 ? `${money(b.rewardAmount)} reward + ${money(fees)} in fees` : 'fixed reward'}</small></div>
        <div><dt>Entry fee</dt><dd data-f="fee">${fee > 0 ? money(fee) : 'Free'}</dd><small data-f="feeNote">${fee > 0 ? `${count(b.entryFeePayers)} paid so far` : 'no entry fee'}</small></div>
        <div><dt>${Date.parse(b.deadline) > Date.now() ? 'Closes in' : 'Deadline'}</dt><dd>${countdownHTML(b.deadline)}</dd><small>${esc(utcDate(b.deadline))}</small></div>
        <div><dt>Entries</dt><dd data-f="entries">${count(b.submissionCount)}</dd><small data-f="passed">${b.submissionsPassed != null ? `${count(b.submissionsPassed)} passed checks` : ''}</small></div>
      </dl>
      <div class="cols3">
        <section class="card" aria-labelledby="rw-h"><h2 id="rw-h">Rewards</h2>${rewardsCard(b)}</section>
        <div class="stack">
          <section class="card" aria-labelledby="dt-h"><h2 id="dt-h">Dates</h2>${phaseList(b)}</section>
          <section class="card side" aria-labelledby="hw-h"><h2 id="hw-h">How it is judged</h2>
            <p>${esc(b.resolution?.summary ?? 'The rules below say how entries are ranked.')}</p>
          </section>
        </div>
        <section class="card card-lb" aria-labelledby="lb-h"><h2 id="lb-h">Leaderboard</h2>
          <ol class="top10" data-f="top10"><li class="muted">Loading the standings…</li></ol>
          <a class="btn btn-wide" href="${lbHref}" data-f="lbLink">Full leaderboard</a>
        </section>
      </div>
      <section class="card prose about" aria-labelledby="ab-h"><h2 id="ab-h">About this bounty</h2>
        ${b.skills?.length ? `<p class="tags">${b.skills.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</p>` : ''}
        ${b.summary ? `<p class="summary">${esc(b.summary)}</p>` : ''}
        ${markdownToHTML(b.description)}
        <p class="dim">Published ${esc(dayDate(b.publishedAt ?? b.opensAt))} · ${count(b.commentCount ?? 0)} comments on make.fun</p>
        ${b.rules ? `<details class="rules" data-f="rules"><summary>Full rules</summary><div data-f="rulesBody"></div></details>` : ''}
      </section>
    </article>`;

  const f = fields(main);
  // The rules run to tens of KB of Markdown: rendered only when opened.
  f.rules?.addEventListener('toggle', () => {
    if (f.rules.open && !f.rulesBody.firstChild) f.rulesBody.innerHTML = markdownToHTML(b.rules);
  });

  const patchNumbers = (fresh) => {
    const feesNow = Number(fresh.entryFeesUsd) || 0;
    setText(f.pot, money(fresh.potUsd ?? fresh.rewardAmount));
    setText(f.potNote, feesNow > 0 ? `${money(fresh.rewardAmount)} reward + ${money(feesNow)} in fees` : 'fixed reward');
    if (Number(fresh.entryFeeUsd) > 0) setText(f.feeNote, `${count(fresh.entryFeePayers)} paid so far`);
    setText(f.entries, count(fresh.submissionCount));
    if (fresh.submissionsPassed != null) setText(f.passed, `${count(fresh.submissionsPassed)} passed checks`);
    if (f.potTotal) setText(f.potTotal, money(fresh.potUsd ?? fresh.rewardAmount));
    setText(f.state, bountyState(fresh)[0]);
  };
  const stopWatching = watchJSON(apiPath.bounty(slug), patchNumbers);

  if (!b.submissionCount) {
    f.top10.innerHTML = '<li class="muted">No entries yet.</li>';
  } else {
    try {
      const board = await cachedJSON(apiPath.leaderboard(slug));
      if (!isCurrent()) return stopWatching;
      const top = topTenRows(board);
      f.top10.innerHTML = top.rows ? `<li class="top10-head" aria-hidden="true"><span>#</span><span>Entrant</span><span class="num">${esc(top.column)}</span></li>${top.rows}` : '<li class="muted">No ranked entries yet.</li>';
      setText(f.lbLink, `Full leaderboard · ${count(top.total)} ranked`);
      setText(f.lbCount, count(top.total));
    } catch (error) {
      f.top10.innerHTML = `<li class="muted">The leaderboard did not load: ${esc(error.message)}</li>`;
    }
  }
  return stopWatching;
}
