// Takes the entry's three screenshots of app/ on live make.fun data in headless Chrome and checks the bounty's
// limits (at most 256 KiB, long side at most 1280 px, short side at least 360 px). A PNG over the size limit is
// re-taken as JPEG at a lower quality. Writes screenshots/ and shots.json.
//   node tools/shoot.mjs
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cdp, ROOT, openPage, sleep, startChrome, startServer } from './cdp.mjs';

const PORT = 8098;
const DEBUG_PORT = 9338;
const MAX_BYTES = 256 * 1024;
/** The cover's selected bounty: one with an entry fee (so pot, fee shares and fee both show) and a live leaderboard. */
const COVER_BOUNTY = process.env.SHOT_COVER ?? 'makefun-frontend-01';
/** The second shot's leaderboard: open, with thousands of entries, to show the virtual list at work. */
const BIG_BOUNTY = process.env.SHOT_BOUNTY ?? 'tiny-chess-01';

const top = await fetch('https://make.fun/api/rankings?limit=1').then((r) => r.json());
const handle = process.env.SHOT_HANDLE ?? top.items[0].handle;

const SHOTS = [
  { name: '1-board', path: `#/bounty/${COVER_BOUNTY}`, viewport: { width: 1280, height: 800 }, ready: `document.querySelectorAll('.top10 .who a').length >= 5`, about: 'Cover, split view: the live board list (reward, entry fee, countdown, entries) beside the selected bounty with live pot, entry fee, closes in, entries, dates and phases, rewards with fee shares, and its top 10.' },
  { name: '2-leaderboard', path: `#/bounty/${BIG_BOUNTY}/leaderboard`, viewport: { width: 1280, height: 800 }, ready: `document.querySelectorAll('.lrow:not([hidden])').length > 5`, about: 'A full leaderboard of 6,000+ entries as a virtual list: linked handles, score and prize now, and the line saying which rows are on screen and how few elements exist.' },
  { name: '3-profile', path: `#/u/${handle}`, viewport: { width: 412, height: 892 }, mobile: true, about: 'A public profile on a phone: record, entries with place, prize and score.' },
];

const dir = join(ROOT, 'screenshots');
for (const file of readdirSync(dir)) rmSync(join(dir, file));

const server = await startServer(PORT);
const chrome = await startChrome(DEBUG_PORT);
const cdp = await Cdp.connect(chrome.wsUrl);
const written = [];
try {
  // One visit, as a person would make it: the board, a bounty, then back after the answers have gone stale, so
  // the status line shows the cache and make.fun's 304s at work (every figure on it is counted, none is staged).
  const page = await openPage(cdp, SHOTS[0].viewport);
  await page.go(`http://127.0.0.1:${PORT}/#/`);
  await page.go(SHOTS[0].path);
  await page.waitFor(SHOTS[0].ready);
  await page.go(SHOTS[1].path);
  await sleep(21_000);
  for (const shot of SHOTS) {
    await page.resize(shot.viewport.width, shot.viewport.height, Boolean(shot.mobile));
    await page.go(shot.path);
    if (shot.ready) await page.waitFor(shot.ready);
    await sleep(1500);
    await page.evaluate('scrollTo(0, 0); document.activeElement?.blur(); true');
    let file = `${shot.name}.png`;
    let { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    for (let quality = 90; Buffer.from(data, 'base64').length > MAX_BYTES && quality >= 50; quality -= 8) {
      file = `${shot.name}.jpg`;
      ({ data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality }));
    }
    const bytes = Buffer.from(data, 'base64');
    const { width, height } = shot.viewport;
    if (bytes.length > MAX_BYTES || Math.max(width, height) > 1280 || Math.min(width, height) < 360) throw new Error(`${file} breaks the limits`);
    writeFileSync(join(dir, file), bytes);
    written.push({ file, path: shot.path, viewport: shot.viewport, shows: shot.about });
    console.log(`${file}: ${width}x${height}, ${bytes.length} bytes, ${shot.path} · ${await page.evaluate(`document.getElementById('net').textContent`)}`);
  }
  if (page.errors.length) throw new Error(`console errors: ${page.errors.join(' | ')}`);
} finally {
  cdp.close();
  chrome.child.kill();
  server.kill();
}
writeFileSync(join(ROOT, 'shots.json'), `${JSON.stringify(written, null, 2)}\n`);
