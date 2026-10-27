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

async function open(browser, options, saved) {
  const context = await browser.newContext(options);
  // Count any attempt to make sound or vibrate: the game should do neither.
  await context.addInitScript((save) => {
    window.__noise = { audio: 0, vibrate: 0 };
    const count = (k) => function () { window.__noise[k]++; };
    window.AudioContext = window.webkitAudioContext = count('audio');
    navigator.vibrate = count('vibrate');
    if (save) localStorage.setItem('darkmaze:v1', JSON.stringify(save));
  }, saved || null);
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
    for (const size of [11, 13, 21, 31, 41, 49]) {
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
  check(await page.evaluate(() => !document.getElementById('darkPanel').hidden && document.getElementById('darkPanel').textContent.includes('Restart this maze')),
    'when the light dies, a Restart this maze button appears at the top');

  const recharge = await page.evaluate(async () => {
    const b = DarkMaze.level.bolts.find((v) => !v.taken);
    if (!b) return null;
    DarkMaze.player.x = b.x; DarkMaze.player.y = b.y;
    await new Promise((r) => setTimeout(r, 250));
    return { taken: b.taken, battery: DarkMaze.game.battery, charge: DarkMaze.CFG.boltCharge };
  });
  check(recharge && recharge.taken && recharge.battery > 0.3 && recharge.battery <= recharge.charge, `walking onto a bolt recharges (${recharge && recharge.battery.toFixed(3)})`);
  check(await page.evaluate(() => document.getElementById('darkPanel').hidden), 'the restart button goes away when the light comes back');
  await wait(page, 450);
  await shot(page, '07-recharged');
  const shown = await page.evaluate(() => {
    const text = document.getElementById('quoteText').textContent;
    return {
      show: document.getElementById('quote').classList.contains('show'),
      by: document.getElementById('quoteBy').textContent,
      known: DarkMaze.QUOTES.some(([q]) => q.split(' / ').join('') === text),
    };
  });
  check(shown.show && shown.known && shown.by.includes(' · '), `picking up a bolt shows a quote from the list (${shown.by})`);
  const deck = await page.evaluate(() => {
    DarkMaze.save.quoteOrder = null;
    const first = Array.from({ length: DarkMaze.QUOTES.length }, () => DarkMaze.nextQuote()[0]);
    let prev = first[first.length - 1], twice = 0;
    for (let i = 0; i < 500; i++) { const q = DarkMaze.nextQuote()[0]; if (q === prev) twice++; prev = q; }
    return { total: DarkMaze.QUOTES.length, unique: new Set(first).size, twice };
  });
  check(deck.total === 100 && deck.unique === 100 && deck.twice === 0,
    `all ${deck.total} quotes show once before any repeats, never twice in a row (${deck.unique} unique, ${deck.twice} back-to-back)`);

  // Let the light die again and take the offered restart: same maze, fresh battery, button gone.
  const seedBefore = await page.evaluate(() => { DarkMaze.game.battery = 0.00002; return DarkMaze.level.seed; });
  await wait(page, 500);
  await shot(page, '07b-light-out-restart');
  check(await page.evaluate(() => !document.getElementById('quote').classList.contains('show')), 'no quote covers the restart button when the light dies');
  await page.click('#btnRestart');
  const restarted = await page.evaluate(() => ({
    seed: DarkMaze.level.seed, battery: DarkMaze.game.battery, state: DarkMaze.game.state,
    taken: DarkMaze.level.bolts.filter((b) => b.taken).length, hidden: document.getElementById('darkPanel').hidden,
  }));
  check(restarted.seed === seedBefore && restarted.state === 'playing' && restarted.battery > 0.99 && restarted.taken === 0 && restarted.hidden,
    'Restart this maze restarts the same maze with a full battery');

  await page.click('#btnPause');
  check(await page.evaluate(() => DarkMaze.game.state === 'paused'), 'pause button pauses');
  await wait(page, 500);
  await shot(page, '08-paused');
  await page.click('[data-action="resume"]');
  check(await page.evaluate(() => DarkMaze.game.state === 'playing'), 'resume resumes');

  const exitSide = await page.evaluate(() => {
    const e = DarkMaze.level.exit, p = DarkMaze.player;
    p.x = e.x + 0.5; p.y = e.y + 0.5; p.vx = p.vy = 0;
    Object.assign(DarkMaze.game, { walked: 1234, time: 754 }); // long-run numbers for the stat tiles
    return e.side;
  });
  const key = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][exitSide];
  await page.keyboard.down(key); await wait(page, 700); await page.keyboard.up(key);
  check(await page.evaluate(() => DarkMaze.game.state === 'won'), 'walking out of the exit wins');
  await wait(page, 2600);
  await shot(page, '09-escaped');
  check((await page.textContent('#sheet')).includes('You got out'), 'escape sheet shows');
  const tiles = await page.evaluate(() => [...document.querySelectorAll('.stats div')].map((d) => ({
    text: d.textContent, fits: d.scrollWidth <= d.clientWidth && d.querySelector('dd').scrollWidth <= d.querySelector('dd').clientWidth,
  })));
  check(tiles.length === 4 && tiles.every((x) => x.fits), `every stat fits its tile ${JSON.stringify(tiles.map((x) => x.text))}`);
  check(!(await page.textContent('#sheet')).includes('cells'), 'summary talks in steps, not cells');
  await page.click('[data-action="next"]');
  check(await page.evaluate(() => DarkMaze.game.state === 'playing' && DarkMaze.game.level === 2 && DarkMaze.level.w === 13), 'next level is bigger');

  // Twenty levels, each two cells bigger, ending at 49×49.
  const sizes = await page.evaluate(() => Array.from({ length: 21 }, (_, i) => DarkMaze.sizeFor(i + 1)));
  check(sizes[0] === 11 && sizes[19] === 49 && sizes.slice(1, 20).every((v, i) => v === sizes[i] + 2) && sizes[20] === 49,
    `20 levels grow from 11×11 to 49×49 (${sizes.slice(0, 20).join(', ')})`);

  // The last level ends the game and sends you back to level 1.
  await page.evaluate(() => DarkMaze.startLevel(20));
  check(await page.evaluate(() => DarkMaze.level.w === 49 && document.getElementById('lvl').textContent.trim() === 'LV 20/20'), 'level 20 is the 49×49 final level');
  const finalSide = await page.evaluate(() => {
    const e = DarkMaze.level.exit, p = DarkMaze.player;
    p.x = e.x + 0.5; p.y = e.y + 0.5; p.vx = p.vy = 0;
    return e.side;
  });
  const fk = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][finalSide];
  await page.keyboard.down(fk); await wait(page, 700); await page.keyboard.up(fk);
  await wait(page, 2600);
  await shot(page, '10-finished');
  const fin = await page.evaluate(() => ({
    text: document.getElementById('sheet').textContent, again: !!document.querySelector('[data-action="again"]'),
    next: !!document.querySelector('[data-action="next"]'), save: { level: DarkMaze.save.level, done: DarkMaze.save.done },
  }));
  check(fin.text.includes('You’re free') && fin.again && !fin.next, 'finishing level 20 shows the ending, with no level 21');
  check(fin.save.level === 1 && fin.save.done, 'after the ending, progress restarts at level 1');
  await page.click('[data-action="again"]');
  check(await page.evaluate(() => DarkMaze.game.level === 1 && DarkMaze.level.w === 11), 'play again starts level 1');

  const noise = await page.evaluate(() => window.__noise);
  check(noise.audio === 0 && noise.vibrate === 0, `no sound and no vibration through a whole run (${noise.audio} audio, ${noise.vibrate} vibrate)`);
  const godly = await page.evaluate(() => DarkMaze.QUOTES.filter(([q]) => /\b(gods?|god's|sun-god|zeus|jove|prometheus|heaven|divine)\b/i.test(q) || /\s(Thy|Thee|Thou)\b/.test(q)).map(([q]) => q));
  check(godly.length === 0, `no in-game quote refers to a god ${godly.length ? JSON.stringify(godly) : ''}`);
  check(await page.evaluate(() => !document.getElementById('btnMute')), 'there is no sound button');

  check(errors.length === 0, `no console errors on phone ${errors.length ? JSON.stringify(errors) : ''}`);
  await context.close();

  // ---------------------------------------------------------------- 2b. choose level
  {
    const lv = await open(browser, { ...devices['iPhone 13'] }, { level: 4, best: { 1: 31, 2: 47, 3: 62 }, hintSeen: true, joyLearned: true });
    const P = lv.page;
    await wait(P, 400);
    const titleButtons = await P.evaluate(() => [...document.querySelectorAll('.sheet .btn')].map((b) => b.textContent.trim()));
    check(titleButtons.includes('Continue · Level 4') && titleButtons.includes('Choose level'), `title offers Choose level once a level is beaten (${titleButtons.join(' | ')})`);
    await P.click('[data-action="levels"]');
    await wait(P, 500);
    await shot(P, '15-choose-level');
    const tiles = await P.evaluate(() => [...document.querySelectorAll('.lvl-tile')].map((b) => ({ n: +b.dataset.level, on: !b.disabled, sub: b.querySelector('small').textContent })));
    const open1to4 = tiles.filter((x) => x.on).map((x) => x.n).join(',');
    check(tiles.length === 20 && open1to4 === '1,2,3,4' && tiles[1].sub === '0:47' && tiles[3].sub === 'Next',
      `beaten levels 1-3 (with best times) and next level 4 can be picked; 5-20 are locked (open: ${open1to4})`);
    await P.click('.lvl-tile[data-level="2"]');
    check(await P.evaluate(() => DarkMaze.game.state === 'playing' && DarkMaze.game.level === 2 && DarkMaze.level.w === 13), 'picking level 2 starts the 13×13 maze');
    const side = await P.evaluate(() => {
      const e = DarkMaze.level.exit, p = DarkMaze.player;
      p.x = e.x + 0.5; p.y = e.y + 0.5; p.vx = p.vy = 0;
      return e.side;
    });
    const k = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][side];
    await P.keyboard.down(k); await wait(P, 700); await P.keyboard.up(k);
    check(await P.evaluate(() => DarkMaze.game.state === 'won' && DarkMaze.save.level === 4), 'beating an earlier level again keeps progress at level 4');
    await wait(P, 2200);
    await P.click('[data-action="menu"]');
    await P.click('[data-action="levels"]');
    await P.click('[data-action="back"]');
    check(await P.evaluate(() => DarkMaze.game.state === 'title' && !!document.querySelector('.logo')), 'Back returns to the title screen');
    const fresh = await open(browser, { ...devices['iPhone 13'] });
    check(await fresh.page.evaluate(() => !document.querySelector('[data-action="levels"]')), 'a new player sees no Choose level button yet');
    check(lv.errors.length === 0 && fresh.errors.length === 0, `no console errors in level select ${JSON.stringify(lv.errors.concat(fresh.errors))}`);
    await lv.context.close(); await fresh.context.close();
  }

  // ---------------------------------------------------------------- 3. other screens
  for (const [name, opts] of [
    ['10-title-landscape', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['11-title-desktop', { viewport: { width: 1280, height: 800 } }],
    ['13-small-phone', { viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    const s = await open(browser, opts);
    await wait(s.page, 600);
    await shot(s.page, name);
    if (name.includes('small')) {
      await s.page.click('[data-action="play"]');
      await s.page.evaluate(() => DarkMaze.startLevel(20));
      await wait(s.page, 600);
      await shot(s.page, name);
      const gaps = await s.page.evaluate(() => {
        const r = (sel) => document.querySelector(sel).getBoundingClientRect();
        const a = r('.lvl'), b = r('.battery'), c = r('.hud-right');
        return [b.left - a.right, c.left - b.right, window.innerWidth - c.right];
      });
      check(gaps.every((g) => g >= 0), `HUD fits a 360px phone at level 20/20 (gaps ${gaps.map((g) => g.toFixed(0)).join(', ')} px)`);
      // The longest quote, and a verse quote, must sit inside the screen without crowding the view.
      for (const pick of ['longest', 'verse']) {
        const fit = await s.page.evaluate((which) => {
          const Q = DarkMaze.QUOTES;
          const q = which === 'longest' ? Q.reduce((a, b) => (b[0].length > a[0].length ? b : a)) : Q.find(([x]) => x.includes(' / '));
          DarkMaze.showQuote(q);
          return q[0];
        }, pick);
        await wait(s.page, 600);
        const box = await s.page.evaluate(() => {
          const r = document.getElementById('quote').getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, height: r.height, vw: innerWidth, lines: document.querySelectorAll('#quoteText span').length };
        });
        await shot(s.page, `14-quote-${pick}`);
        check(box.left >= 0 && box.right <= box.vw && box.height <= 150,
          `${pick} quote fits a 360px phone (${Math.round(box.height)}px tall${box.lines > 1 ? `, ${box.lines} verse lines` : ''}): “${fit.slice(0, 40)}…”`);
      }
    }
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

