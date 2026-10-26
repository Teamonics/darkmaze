// Smoke test for Dark Maze.
//   1. Generates hundreds of mazes and checks the rules: one route between any two cells, one exit, sane bolts.
//   2. Plays on an emulated phone: real touch drag, battery stages, recharge, pause, escape, next level.
//   3. Renders the title in landscape and on desktop.
// Run: node tests/smoke.js   (needs Playwright with Chromium). Screenshots go to $SHOT_DIR or tests/screenshots/.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const PAGE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const wait = (page, ms) => page.waitForTimeout(ms);

async function open(browser, options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(PAGE);
  await page.waitForFunction(() => window.DarkMaze && window.DarkMaze.level);
  return { context, page, errors };
}

(async () => {
  const browser = await chromium.launch();
  const { context, page, errors } = await open(browser, { ...devices['iPhone 13'] });

  // ---------------------------------------------------------------- 1. maze rules
  const report = await page.evaluate(() => {
    const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
    const problems = [];
    let mazes = 0, bolts = 0, pathCells = 0;
    for (const size of [11, 13, 21, 31, 41]) {
      for (let k = 1; k <= 60; k++) {
        const seed = k * 7919, tag = `${size}x${size} seed ${seed}`;
        const m = DarkMaze.buildLevel(size, seed);
        const { w, h, walls } = m, n = w * h;
        mazes++;
        let passages = 0, openings = 0;
        for (let c = 0; c < n; c++) {
          const x = c % w, y = (c / w) | 0;
          for (let d = 0; d < 4; d++) {
            if (walls[c] & (1 << d)) continue;
            const nx = x + DX[d], ny = y + DY[d];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) { openings++; continue; }
            if (walls[ny * w + nx] & (1 << ((d + 2) & 3))) problems.push(`${tag}: one-sided wall at cell ${c}`);
            if (d === 1 || d === 2) passages++;
          }
        }
        const seen = new Uint8Array(n), stack = [m.start];
        seen[m.start] = 1;
        while (stack.length) {
          const c = stack.pop(), x = c % w, y = (c / w) | 0;
          for (let d = 0; d < 4; d++) {
            if (walls[c] & (1 << d)) continue;
            const nx = x + DX[d], ny = y + DY[d];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const nb = ny * w + nx;
            if (!seen[nb]) { seen[nb] = 1; stack.push(nb); }
          }
        }
        const reached = seen.reduce((a, b) => a + b, 0);
        // Connected with exactly n-1 passages = a spanning tree = exactly one route between any two cells.
        if (reached !== n) problems.push(`${tag}: only ${reached}/${n} cells reachable`);
        if (passages !== n - 1) problems.push(`${tag}: ${passages} passages, expected ${n - 1}`);
        if (openings !== 1) problems.push(`${tag}: ${openings} openings in the outer wall`);
        if (m.path[0] !== m.start || m.path[m.path.length - 1] !== m.exit.c) problems.push(`${tag}: route endpoints wrong`);
        for (let i = 1; i < m.path.length; i++) {
          const a = m.path[i - 1], b = m.path[i];
          if (Math.abs((a % w) - (b % w)) + Math.abs(((a / w) | 0) - ((b / w) | 0)) !== 1) problems.push(`${tag}: route jumps`);
        }
        const cells = new Set();
        for (const b of m.bolts) {
          if (b.c === m.start || b.c === m.exit.c) problems.push(`${tag}: bolt on start or exit`);
          if (cells.has(b.c)) problems.push(`${tag}: two bolts in one cell`);
          cells.add(b.c);
        }
        if (m.path.length > 2 * DarkMaze.CFG.boltEvery && m.bolts.length < 2) problems.push(`${tag}: too few bolts`);
        bolts += m.bolts.length; pathCells += m.path.length;
      }
    }
    return { mazes, problems: problems.slice(0, 12), count: problems.length, cellsPerBolt: (pathCells / bolts).toFixed(1) };
  });
  check(report.count === 0, `${report.mazes} mazes: one route between any two cells, one exit, bolts placed (${report.cellsPerBolt} route cells per bolt) ${report.count ? JSON.stringify(report.problems) : ''}`);

  // ---------------------------------------------------------------- 2. play on a phone
  await wait(page, 600);
  await shot(page, '01-title-phone');
  await page.click('[data-action="play"]');
  await page.waitForFunction(() => DarkMaze.game.state === 'playing');
  check(await page.isVisible('#hint'), 'finger-drag hint shows on first play');
  await wait(page, 900);
  await shot(page, '02-start');

  const dir = await page.evaluate(() => {
    const m = DarkMaze.level;
    for (let d = 0; d < 4; d++) if (!(m.walls[m.start] & (1 << d))) return d;
    return 0;
  });
  const before = await page.evaluate(() => ({ x: DarkMaze.player.x, y: DarkMaze.player.y }));
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const sx = 195, sy = 520;
  await touch('touchStart', sx, sy);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', sx + DX[dir] * 6 * i, sy + DY[dir] * 6 * i); await wait(page, 16); }
  await wait(page, 250);
  await shot(page, '03-dragging');
  await wait(page, 250);
  await touch('touchEnd');
  const after = await page.evaluate(() => ({ x: DarkMaze.player.x, y: DarkMaze.player.y, ang: DarkMaze.player.ang, hint: !document.getElementById('hint').hidden }));
  const moved = (after.x - before.x) * DX[dir] + (after.y - before.y) * DY[dir];
  check(moved > 0.5, `touch drag walks the dot (${moved.toFixed(2)} cells in the drag direction)`);
  const want = Math.atan2(DY[dir], DX[dir]);
  const angErr = Math.abs(Math.atan2(Math.sin(after.ang - want), Math.cos(after.ang - want)));
  check(angErr < 0.2, `flashlight points along the drag (off by ${angErr.toFixed(3)} rad)`);
  check(!after.hint, 'hint hides after the first drag');
  await wait(page, 700);
  check(await page.evaluate(() => !DarkMaze.save.joyLearned && DarkMaze.joy.vis < 0.05), 'joystick ring fades out on release');

  // Once the controls are learned the ring stays hidden, but dragging still steers.
  const ringGone = await page.evaluate(() => {
    DarkMaze.joy.taught = DarkMaze.CFG.joyTeach - 0.2;
    return { x: DarkMaze.player.x, y: DarkMaze.player.y };
  });
  await touch('touchStart', sx, sy);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', sx - DX[dir] * 6 * i, sy - DY[dir] * 6 * i); await wait(page, 16); }
  await wait(page, 900);
  const learned = await page.evaluate(() => ({ learned: DarkMaze.save.joyLearned, vis: DarkMaze.joy.vis, x: DarkMaze.player.x, y: DarkMaze.player.y }));
  await touch('touchEnd');
  check(learned.learned && learned.vis < 0.05, `joystick ring hides for good after the first few seconds of walking (vis ${learned.vis.toFixed(3)})`);
  check(Math.hypot(learned.x - ringGone.x, learned.y - ringGone.y) > 0.3, 'dragging still steers with the ring hidden');

  // A drag into a wall must not let the dot through.
  const wallTest = await page.evaluate(async () => {
    const m = DarkMaze.level, p = DarkMaze.player;
    // Any route cell that has a wall on some side (the start can be a four-way junction).
    const cell = m.path.find((c) => m.walls[c] & 15 && c !== m.exit.c);
    const x = cell % m.w, y = (cell / m.w) | 0;
    p.x = x + 0.5; p.y = y + 0.5; p.vx = p.vy = 0;
    const d = [0, 1, 2, 3].find((k) => m.walls[cell] & (1 << k));
    return { d, x, y };
  });
  const k2 = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][wallTest.d];
  await page.keyboard.down(k2); await wait(page, 600); await page.keyboard.up(k2);
  const stillIn = await page.evaluate(({ x, y }) => Math.floor(DarkMaze.player.x) === x && Math.floor(DarkMaze.player.y) === y, wallTest);
  check(stillIn, 'walls stop the dot');

  await page.evaluate(() => { DarkMaze.game.battery = 0.5; });
  await wait(page, 500);
  await shot(page, '04-battery-half');
  await page.evaluate(() => { DarkMaze.game.battery = 0.1; });
  await wait(page, 500);
  await shot(page, '05-battery-low');
  check(await page.evaluate(() => document.getElementById('battery').dataset.state) === 'crit', 'battery bar turns critical when low');
  await page.evaluate(() => { DarkMaze.game.battery = 0.00002; });
  await wait(page, 700);
  await shot(page, '06-dark');
  check(await page.evaluate(() => DarkMaze.game.battery === 0 && document.getElementById('battery').dataset.state === 'dead'), 'light goes out at 0%');
  check((await page.textContent('#toast')).includes('dead'), 'player is told the light died');

  const recharge = await page.evaluate(async () => {
    const b = DarkMaze.level.bolts.find((v) => !v.taken);
    if (!b) return null;
    DarkMaze.player.x = b.x; DarkMaze.player.y = b.y;
    await new Promise((r) => setTimeout(r, 250));
    return { taken: b.taken, battery: DarkMaze.game.battery, charge: DarkMaze.CFG.boltCharge };
  });
  check(recharge && recharge.taken && recharge.battery > 0.3 && recharge.battery <= recharge.charge, `walking onto a bolt recharges (${recharge && recharge.battery.toFixed(3)})`);
  await wait(page, 150);
  await shot(page, '07-recharged');

  await page.click('#btnPause');
  check(await page.evaluate(() => DarkMaze.game.state === 'paused'), 'pause button pauses');
  await wait(page, 500);
  await shot(page, '08-paused');
  await page.click('[data-action="resume"]');
  check(await page.evaluate(() => DarkMaze.game.state === 'playing'), 'resume resumes');

  const exitSide = await page.evaluate(() => {
    const e = DarkMaze.level.exit, p = DarkMaze.player;
    p.x = e.x + 0.5; p.y = e.y + 0.5; p.vx = p.vy = 0;
    return e.side;
  });
  const key = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][exitSide];
  await page.keyboard.down(key); await wait(page, 700); await page.keyboard.up(key);
  check(await page.evaluate(() => DarkMaze.game.state === 'won'), 'walking out of the exit wins');
  await wait(page, 2600);
  await shot(page, '09-escaped');
  check((await page.textContent('#sheet')).includes('You got out'), 'escape sheet shows');
  await page.click('[data-action="next"]');
  check(await page.evaluate(() => DarkMaze.game.state === 'playing' && DarkMaze.game.level === 2 && DarkMaze.level.w === 13), 'next level is bigger');

  check(errors.length === 0, `no console errors on phone ${errors.length ? JSON.stringify(errors) : ''}`);
  await context.close();

  // ---------------------------------------------------------------- 3. other screens
  for (const [name, opts] of [
    ['10-title-landscape', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['11-title-desktop', { viewport: { width: 1280, height: 800 } }],
  ]) {
    const s = await open(browser, opts);
    await wait(s.page, 600);
    await shot(s.page, name);
    if (name.includes('desktop')) {
      await s.page.click('[data-action="play"]');
      await wait(s.page, 900);
      await shot(s.page, '12-play-desktop');
    }
    check(s.errors.length === 0, `no console errors (${name}) ${s.errors.length ? JSON.stringify(s.errors) : ''}`);
    await s.context.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

