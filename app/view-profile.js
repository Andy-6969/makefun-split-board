// An account's public profile (/api/profiles/<handle>): who they are, their record in six numbers, every entry
// with its place, prize and score, and the payouts they received with a link to each transaction.
export { renderProfile as render, recordStats, entryItems, payoutItems, avatarHTML };

import { apiPath, cachedJSON, count, dayDate, esc, money, ordinal, scoreText } from './core.js';

const MAKEFUN = 'https://make.fun';

/** The six numbers of an account's record; prize money first, in the accent. */
function recordStats(record = {}) {
  const stats = [
    ['Prize money', money(record.prize_usd ?? 0), 'money'],
    ['Wins', count(record.competitions_won ?? 0)],
    ['Podiums', count(record.podium_finishes ?? 0)],
    ['Best place', record.best_placement ? ordinal(record.best_placement) : '—'],
    ['Placed', count(record.competitions_placed ?? 0)],
    ['Entered', count(record.competitions_entered ?? 0)],
  ];
  return stats.map(([label, value, cls]) => `<div><dt>${label}</dt><dd${cls ? ` class="${cls}"` : ''}>${value}</dd></div>`).join('');
}

/**
 * The avatar the API points at (a path on make.fun), or the handle's initial when there is none. crossorigin is
 * set before src, as the page loads no other origin's images without CORS.
 */
function avatarHTML(p) {
  const path = p.avatar?.url_small ?? p.avatar?.url ?? p.image;
  if (!path) return `<span class="avatar avatar-none" aria-hidden="true">${esc((p.display_name || p.handle || '?').slice(0, 1).toUpperCase())}</span>`;
  const src = /^https:\/\/make\.fun\//.test(path) ? path : `${MAKEFUN}${path.startsWith('/') ? '' : '/'}${path}`;
  return `<img class="avatar" crossorigin="anonymous" src="${esc(src)}" alt="" width="72" height="72" decoding="async">`;
}

/** A linked account: the API gives either a name or an object with url and username; only https links are kept. */
function socialLink(label, value, urlFor) {
  if (!value) return '';
  const url = typeof value === 'object' ? value.url : urlFor(String(value));
  if (!/^https:\/\//.test(url ?? '')) return '';
  return `<a href="${esc(url)}" rel="noopener noreferrer" target="_blank">${label}</a>`;
}

/** One item per entry: the bounty, the entry's title, and its place, prize and score. */
function entryItems(solutions = []) {
  return solutions
    .map((s) => {
      const c = s.competition ?? {};
      const open = c.status === 'open';
      const place = s.placement ? ordinal(s.placement) : open ? 'Pending' : '—';
      const score = scoreText(s.score?.display, s.score?.column);
      return `<li class="entry">
        <a class="entry-bounty" href="#/bounty/${encodeURIComponent(c.slug ?? '')}">${esc(c.title ?? c.slug ?? 'Bounty')}</a>
        <p class="entry-title">${esc(s.title ?? '')}</p>
        <p class="dim">${esc([c.category, `entered ${dayDate(s.entered_at)}`, open ? 'still open' : c.status].filter(Boolean).join(' · '))}</p>
        <dl class="mini">
          <div><dt>Place</dt><dd>${place}</dd></div>
          <div><dt>Prize</dt><dd${s.prize_usd ? ' class="money"' : ''}>${s.prize_usd ? money(s.prize_usd) : '—'}</dd></div>
          <div><dt>${esc(s.score?.column?.title ?? 'Score')}</dt><dd>${esc(score)}</dd></div>
        </dl>
      </li>`;
    })
    .join('');
}

/** One item per payout, newest first, linking to the transaction on the explorer the API names. */
function payoutItems(payouts = []) {
  return [...payouts]
    .sort((a, b) => Date.parse(b.paid_at) - Date.parse(a.paid_at))
    .map(
      (p) => `<li class="payout">
        <span class="money big-s">${money(p.amount_usd)}</span>
        <span><a href="#/bounty/${encodeURIComponent(p.competition?.slug ?? '')}">${esc(p.competition?.title ?? '')}</a>
        <span class="dim">${p.place ? `${ordinal(p.place)} place · ` : ''}${esc(dayDate(p.paid_at))}${p.explorer_url ? ` · <a href="${esc(p.explorer_url)}" rel="noopener noreferrer" target="_blank">transaction</a>` : ''}</span></span>
      </li>`,
    )
    .join('');
}

async function renderProfile(main, { params: [handle], isCurrent }) {
  const p = await cachedJSON(apiPath.profile(handle));
  if (!isCurrent()) return;
  const name = p.display_name || p.handle;
  document.title = `${name} · make.fun`;
  const links = [
    socialLink('GitHub', p.github_login, (name) => `https://github.com/${encodeURIComponent(name)}`),
    socialLink('X', p.x, (name) => `https://x.com/${encodeURIComponent(name.replace(/^@/, ''))}`),
    socialLink('Discord', p.discord, (id) => `https://discord.com/users/${encodeURIComponent(id)}`),
    p.wallet?.address && `<a href="${esc(p.wallet.explorer_url ?? `https://solscan.io/account/${p.wallet.address}`)}" rel="noopener noreferrer" target="_blank">Wallet ${esc(p.wallet.address.slice(0, 4))}…${esc(p.wallet.address.slice(-4))}</a>`,
  ].filter(Boolean);
  const solutions = p.solutions ?? [];
  const payouts = p.payouts ?? [];

  main.innerHTML = `
    <article class="profile">
      <p class="crumbs"><a href="#/">All bounties</a> <span aria-hidden="true">/</span> <span>Profile</span></p>
      <header class="who-head">
        ${avatarHTML(p)}
        <div>
          <h1>${esc(name)}</h1>
          <p class="dim">@${esc(p.handle)}${p.house ? ' · house account' : ''} · joined ${esc(dayDate(p.joined_at))}</p>
          ${links.length ? `<p class="links">${links.join('')}</p>` : ''}
        </div>
      </header>
      ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}
      <div class="profile-cols">
        <dl class="record">${recordStats(p.record)}</dl>
        <section class="card" aria-labelledby="en-h">
          <h2 id="en-h">Entries <span class="n">${count(solutions.length)}</span></h2>
          ${solutions.length ? `<ol class="entries">${entryItems(solutions)}</ol>` : '<p class="muted">No public entries yet.</p>'}
        </section>
        ${payouts.length ? `<section class="card" aria-labelledby="po-h"><h2 id="po-h">Payouts <span class="n">${count(payouts.length)}</span></h2><ol class="payouts">${payoutItems(payouts)}</ol></section>` : ''}
      </div>
    </article>`;

  // Ready once the avatar is decoded (or failed), so a screenshot never shows a half-drawn image.
  const avatar = main.querySelector('img.avatar');
  if (avatar && !avatar.complete) await new Promise((done) => {
    avatar.addEventListener('load', done, { once: true });
    avatar.addEventListener('error', () => {
      avatar.replaceWith(Object.assign(document.createElement('span'), { className: 'avatar avatar-none', textContent: name.slice(0, 1).toUpperCase() }));
      done();
    }, { once: true });
  });
}
