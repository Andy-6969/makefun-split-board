# make.fun bounties: a fast, live frontend

[![make.fun · makefun-frontend-01](https://make.fun/badge/makefun-frontend-01.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![rank](https://make.fun/badge/makefun-frontend-01/Andy-6969/makefun-split-board/rank.svg)](https://make.fun/bounty/makefun-frontend-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![reward](https://make.fun/badge/makefun-frontend-01/Andy-6969/makefun-split-board/reward.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)

Bounty page: [make.fun/bounty/makefun-frontend-01](https://make.fun/bounty/makefun-frontend-01)

An entry for make.fun's `makefun-frontend-01` bounty: a calm, dense board of make.fun's live bounties, a split
board-beside-bounty view, a virtual leaderboard and public profiles. Plain static files in `app/` (ES modules, no
framework, no build step) reading make.fun's public API (`https://make.fun/api`, GET only).

## Routes

| Hash | Surface | API |
| --- | --- | --- |
| `#/` (`?sort=pot&cat=Games`) | Bounty board: reward or live pot, entry fee, live countdown, entries and entries in the last hour; sort and category chips | `/api/competitions?status=open&activity=times` |
| `#/bounty/<slug>` | Wide screens: the board list beside the bounty (split view). The bounty: live pot, entry fee, closes in, entries, dates and phases, status, rewards with fee shares, top 10, description and rules. Phones: one column | `/api/competitions/<slug>`, then its leaderboard |
| `#/bounty/<slug>/leaderboard` | Full leaderboard, virtualised, with search and a live "rows on screen" line | `/api/competitions/<slug>/leaderboard?rows=first` |
| `#/u/<handle>` | Public profile: record, entries with place/prize/score, payouts | `/api/profiles/<handle>` |

"Taking entries" is decided by the opening time and the deadline, not by the API's `status`.

## Run

```bash
node serve.ts            # http://localhost:8080 (any static server with app/ as the root works)
node tools/uitest.mjs    # end-to-end test on live data in headless Chrome
node tools/shoot.mjs     # the 3 screenshots in screenshots/ and shots.json
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts   # hand-in: app/, screenshots/, dossier.json
```

The tools need Node 22+ and Chrome (`CHROME_PATH` overrides the Windows default path).

## How it stays fast

- **2-file first load, about 2.5 KB gzipped**: `index.html` (with an inline shell style) and `core.js` (the cache,
  the status counters and the router). Everything else arrives by literal `import()`: one module per surface plus
  `ui.js`, which holds the shared helpers and the full stylesheet as a constructable sheet adopted on first use.
- **One JSON cache** (`cachedJSON`, `revalidateByETag` in `core.js`): answers are reused from memory for 20 s with no
  request, then served stale at once while revalidated in the background, de-duplicated in flight. Fetches use
  `cache: 'no-cache'`, so the browser revalidates with its ETag and make.fun answers `304` within the minute (its 304
  has no CORS header, so a hand-written `If-None-Match` would fail). An unchanged ETag skips reading and parsing.
- **Updated in place**: watched answers revalidate once a minute while the tab is visible and patch changed text
  nodes; sorting, filtering and the split view's selection move existing rows with a keyed patch; one timer drives
  every countdown and rewrites only its text node. The route's module and data load together; hover or focus on a
  link prefetches both.
- **Virtual leaderboard**: 6,000+ rows scroll through a pool of about 30 row elements; one leaderboard download serves
  both the bounty's top 10 and the full list.
- The header's status line counts real API calls, memory hits, 304s and JSON received; the footer states the first
  load measured from `main.ts`'s dossier (the UI test checks it against the files' gzip-9 size).

Accessible by default: skip link, visible focus rings, real links and buttons, 44 px tap targets on phones,
`prefers-reduced-motion` and `prefers-color-scheme: dark` respected, one column at 390 px with no sideways scroll.

MIT licensed (see LICENSE). `vendor/makefun-frontend.ts` is make.fun's library, unchanged.

---

Built as an entry in the [make.fun `makefun-frontend-01` bounty](https://make.fun/bounty/makefun-frontend-01).
