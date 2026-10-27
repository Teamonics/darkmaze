# Dark Maze

A top-down maze you play in the dark. You're a small dot holding a flashlight that is slowly dying. Find the one way out before it goes black.

Open `index.html` in any modern browser, on a phone or a computer. The game is one self-contained file: no libraries, fonts, images or network requests. Sounds are generated in code.

## How to play

- **Drag anywhere** on the screen to walk. The dot walks the way you drag. Drag a short way to turn the light without moving; drag further to walk faster. For your first few seconds of walking, a joystick ring under your finger shows how the drag steers. After that it stays hidden.
- **The flashlight dims and its reach shrinks** over about a minute. Near the end it flickers and you hear a heartbeat. Then it goes out.
- **Lightning bolts** recharge 35% of the battery. Walking over one with a full battery leaves it there for later.
- **The light shines through walls**, so you can see what's on the other side. You can't walk through them.
- **There is only one path out.** The single exit is somewhere in the outer wall, and a faint cold light leaks in around it.
- With the light dead you can still move. Bumping or sliding along a wall shows that wall for a moment, and bolts very close by glimmer.
- When you escape, the lights come up and your route is traced over the whole maze.
- There are **20 levels**, each two cells bigger than the last: 11 × 11 up to a final 49 × 49. Clearing level 20 ends the game.

Desktop: drag with the mouse, or use WASD / arrow keys. `P` or `Esc` pauses.

## How it works

| Part | Approach |
| --- | --- |
| Maze | Growing-tree carve (75% newest, 25% random cell). This makes a spanning tree, so there is exactly one route between any two cells. You start in the centre. One boundary wall is opened, chosen from the cells farthest from the start. |
| Bolts | The route out is split into stretches of 11 cells. Each stretch gets one bolt in a side branch near it, preferring dead ends, so the bolts don't trace the answer. Extra bolts go in far dead ends. |
| Light | The maze is drawn fully lit, then multiplied by a small world-space light map. The map holds the beam (radial × conic falloff), a halo around the dot, the exit glow and wall-touch flashes. Nothing occludes it, which is why the light passes through walls. It fades over about 0.16 s, so sweeps and flicker look soft. |
| Battery | Drains linearly over 62 s. Brightness and reach both follow the charge, and the last 5% sputters out. |
| Movement | Circle-vs-box collision with sub-stepping. Gentle steering keeps you centred in corridors and slides you into an opening you're pushing toward. |
| Mobile | Pointer events with capture, `touch-action: none`, no pinch zoom or pull-to-refresh, safe-area insets, pixel ratio capped at 2, auto-pause when the tab is hidden. Haptics are used where the browser allows them. |

All tuning values live in the `CFG` object at the top of the script (speed, battery life, bolt charge, beam reach, and so on).

Your level, best times, sound setting and whether you've seen the drag hint are saved in `localStorage`.

## Tests

```sh
node tests/smoke.js
```

Needs Playwright with Chromium. The test:

- Generates 360 mazes from 11×11 to 49×49 and checks the rules: every cell reachable, no loops, exactly one opening, a connected route, and sensible bolt placement.
- Plays on an emulated iPhone: a real touch drag, walls blocking the dot, battery stages, the light dying, a recharge, pause and resume, escaping, and the next level.
- Renders the title screen in landscape and on desktop.

It fails on any console error. Screenshots go to `tests/screenshots/`, or to `$SHOT_DIR` if set.
