# make.fun bounties: a fast, live frontend

An entry for make.fun's `makefun-frontend-01` bounty: a calm, dense board of make.fun's live bounties with a page,
a full leaderboard and public profiles behind it. Plain static files in `app/` (ES modules and one stylesheet, no
framework, no build step) reading make.fun's public API (`https://make.fun/api`, GET only).

## Routes

| Hash | Surface | API |
| --- | --- | --- |
| `#/` (`?sort=pot&cat=Games`) | Bounty board: reward or live pot, entry fee, live countdown, entries and entries in the last hour; sort and category chips | `/api/competitions?status=open&activity=times` |
| `#/bounty/<slug>` | Bounty page: live pot, entry fee, closes in, entries; rewards table with fee shares; dates and phases; how it is judged; top 10; description and rules | `/api/competitions/<slug>`, then its leaderboard |
| `#/bounty/<slug>/leaderboard` | Full leaderboard, virtualised, with search | `/api/competitions/<slug>/leaderboard?rows=first` |
| `#/u/<handle>` | Public profile: record, entries with place/prize/score, payouts | `/api/profiles/<handle>` |

"Taking entries" is decided by the deadline (and the opening time), not by the API's `status`: an open bounty past
its deadline is listed apart as "past the deadline, results pending".

## Run

```bash
node serve.ts            # http://localhost:8080 (any static server with app/ as the root works)
node tools/uitest.mjs    # end-to-end test on live data in headless Chrome
node tools/shoot.mjs     # the 3 screenshots in screenshots/ and shots.json
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts   # hand-in: app/, screenshots/, dossier.json
```

The tools need Node 22+ and Chrome (`CHROME_PATH` overrides the Windows default path).

## How it stays fast

- **Small first load**: `index.html`, `core.js` and `style.css` only (about 10 KB gzipped). Each surface is its own
  module loaded by a literal `import()` when its route is opened, or earlier on hover/focus of a link to it.
- **One JSON cache** (`cachedJSON` in `core.js`): answers are reused from memory for 20 s with no request, then
  served stale at once while revalidated in the background. Requests to the same path are de-duplicated. Fetches use
  `cache: 'no-cache'`, so the browser revalidates with the ETag it holds and make.fun answers `304` within the
  minute (make.fun's 304 has no CORS header, so a hand-written `If-None-Match` would fail cross-origin). An answer
  whose ETag is unchanged is not read or parsed again.
- **Updated in place**: the board and bounty page revalidate once a minute (only while the tab is visible) and patch
  changed text nodes; sorting and filtering move existing rows with a keyed patch; one timer drives every countdown
  and rewrites only its text node.
- **Virtual leaderboard**: 6,000+ rows scroll through a fixed pool of about 30 row elements.
- **One leaderboard download** serves both the bounty page's top 10 and the full leaderboard.
- The status line under the header counts real API calls, answers served from memory, 304s and JSON received.

Accessible by default: skip link, visible focus rings, real links and buttons, 44 px tap targets on phones,
`prefers-reduced-motion` and `prefers-color-scheme: dark` respected, one column at 390 px with no sideways scroll.

MIT licensed (see LICENSE). `vendor/makefun-frontend.ts` is make.fun's library, unchanged.
