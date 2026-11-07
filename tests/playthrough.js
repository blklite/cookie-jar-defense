// Headless playthrough of game.html: a scripted player that spends every coin.
// Fails on any page error or page scroll. Prints wave, cookies and coins per wave.
//
//   npm install && npm test             (10 waves)
//   WAVES=30 npm test                   (full game, a few minutes)
//   CHROMIUM=/path/to/chrome npm test   (use a specific browser)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const WAVES = Number(process.env.WAVES || 10);
const TYPES = { '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg' };

const COST = { nerf: 50, balloon: 80, bubble: 70, chicken: 140 };
const PLAN = [['nerf', 3, 4], ['nerf', 5, 3], ['balloon', 4, 4], ['bubble', 3, 6], ['nerf', 5, 11], ['balloon', 4, 6],
  ['chicken', 3, 11], ['nerf', 6, 9], ['balloon', 5, 9], ['bubble', 4, 9], ['chicken', 6, 7], ['balloon', 3, 7],
  ['nerf', 2, 3], ['chicken', 5, 6], ['balloon', 5, 7], ['nerf', 6, 11], ['bubble', 3, 9], ['chicken', 8, 8],
  ['nerf', 3, 3], ['balloon', 5, 4], ['nerf', 4, 7], ['bubble', 6, 6], ['chicken', 2, 9], ['nerf', 3, 10]];

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

(async () => {
  const server = await serve();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install();
  await page.goto(`http://127.0.0.1:${server.address().port}/game.html`);
  await page.clock.runFor(300);

  // The fake clock freezes animation frames, so every click is forced.
  const click = sel => page.click(sel, { force: true });
  await click('[data-act=play]');
  await click('#speed');
  const box = await page.locator('#cv').boundingBox();
  const tap = async (c, r) => { await page.mouse.click(box.x + (c + .5) * box.width / 9, box.y + (r + .5) * box.height / 12); await page.clock.runFor(20); };
  const coins = async () => +(await page.locator('#coins').textContent());
  const isSel = async t => (await page.locator(`.card[data-type=${t}]`).getAttribute('class')).includes('sel');
  const over = async () => !(await page.locator('#ov').isHidden());

  const placed = []; let next = 0, up = 0;
  for (let w = 0; w < WAVES; w++) {
    for (let guard = 0; guard < 20; guard++) {
      const c = await coins();
      if (next < PLAN.length && c >= COST[PLAN[next][0]]) {
        const [t, x, y] = PLAN[next++];
        if (!(await isSel(t))) await click(`.card[data-type=${t}]`);
        await tap(x, y); placed.push([x, y]);
        if (await isSel(t)) await click(`.card[data-type=${t}]`);
      } else if (placed.length && (next >= PLAN.length || c >= 250)) {
        await tap(...placed[up++ % placed.length]);
        const btn = page.locator('[data-act=up]');
        if (await btn.count() && await btn.isEnabled()) await btn.click({ force: true });
        await page.locator('.ihead [data-act=close]').click({ force: true }).catch(() => {});
        if (guard > 6) break;
      } else break;
    }
    await click('#go');
    for (let k = 0; k < 120; k++) {
      await page.clock.runFor(1500);
      if (await over()) break;
      const go = await page.locator('#go').textContent();
      if (go.startsWith('Start') || go.startsWith('All')) break;
    }
    const scroll = await page.evaluate(() => [document.scrollingElement.scrollTop, document.getElementById('app').scrollTop]);
    if (scroll.some(v => v !== 0)) errors.push(`page scrolled ${scroll} after wave ${w + 1}`);
    console.log(`wave ${await page.locator('#wave').textContent()}  cookies ${await page.locator('#cookies').textContent()}  coins ${await coins()}`);
    if (await over()) break;
  }
  await browser.close();
  server.close();
  if (errors.length) { console.error('FAIL\n' + errors.join('\n')); process.exit(1); }
  console.log('PASS: no page errors, no scroll');
})().catch(e => { console.error(e); process.exit(1); });
