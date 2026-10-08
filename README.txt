ESA ARCADE - V3
===============

A two-player party game collection for the Egyptian Students Association.
Static HTML / CSS / vanilla JavaScript. No build step, no dependencies.


HOW TO RUN
----------
1. Open the ESA_Arcade_v1 folder.
2. Double-click index.html.
3. It runs directly in Chrome / Edge with nothing installed.

The scripts are plain <script> tags, not ES modules, specifically so that
opening the file straight from disk keeps working. Do not convert them to
modules unless the project moves to being served over http.


HOW TO HOST
-----------
Upload the whole folder to GitHub Pages, Netlify or any static host.
Keep the folder structure unchanged so the image paths resolve.


FLOW
----
Welcome -> Mode Select -> CASUAL or TOURNAMENT

Casual:     Character Select -> VS -> Game Library -> Intro -> Match ->
            Results (Rematch / Game Library / Change Players)
Tournament: Participant Select -> Intro -> [Game Draw -> Fixtures -> Hub ->
            matches -> Standings] per league round -> Bracket ->
            knockout rounds -> The Final -> Champion

BACK / Esc works on every non-game screen. In a match Esc opens the pause
menu. Only actions that destroy progress ask for confirmation.


ADDING A NEW ESA MEMBER
-----------------------
1. Put a normal + hurt image pair in assets/.
2. Add one ESA.Characters.register({...}) entry in js/characters.js.
Character Select, Tournament participant select, the HUD, every game and
the champion screen pick it up automatically. Optional fields: portrait,
selected, victory art, tagline, victoryAnimation (a CSS class).

Current roster: Zima, Shaza, Gneady, Ahmood, Saif, Amr, Adam, Maryam, Lama.

Art with transparent padding (e.g. 1024x1024 exports) is cropped and scaled
IN CODE from the "trim" numbers in each registry entry - the PNGs are never
edited. trim = [x, y, w, h, fileW, fileH] of the visible art per image. To
measure a new image: open it in any editor, note the bounding box of the
visible pixels, or omit trim if the art is already tightly cropped.

Gameplay size and collisions come from the same visible-art rectangle
(ESA.spriteSize / ESA.bodyBounds in js/characters.js). Coin Rush pickups use
a centred body box, not the feet. Open index.html?hitbox to draw the boxes.

TOUCH DEVICES (phones, tablets, touchscreen laptops)
---------------------------------------------------
Touch mode switches on automatically on phones/tablets, or on a laptop the
moment someone touches the screen (typing game keys switches it back off).
Force it for testing with  index.html?touch=1  (or ?touch=0).

Desktop and touch are separate presentations (body.is-touch); desktop
looks and plays exactly as before.

  Menus           designed for portrait (touch wording: Tap to Start, Tap to
                  choose, swipe the arcade floor); safe-area aware.
  Entering a game ROTATE TO PLAY (3-2-1, never blocks) -> how-to card with
                  PLAY / CONTROLS / BACK (auto-starts after 6 s).
  Gameplay        ALWAYS landscape. If the phone stays portrait (or rotation
                  lock is on) the play scene is drawn rotated, so turning the
                  phone gives a full-screen landscape game. Android also gets
                  fullscreen + landscape lock when Start is tapped.
  HUD             slim bar: pause, scores / clock, gear (Controls).
  Controls        compact translucent joystick that floats to your thumb
                  anywhere on your half, plus action buttons where needed.
  Air Hockey      joystick + DASH          Coin Rush / Bomb Pass  joystick only
  Bonk Booth      tap the holes directly - head-to-head layout, each player
                  owns one half of the screen.
  Controls setup  gear button, pause menu or how-to card: drag controls,
                  Size, Visibility, Swap, Reset. P1 and P2 each have their
                  own layout and zone.

Control preferences live in localStorage key "esaArcade.touchControls.v1"
(positions normalized 0..1, sizes, opacity). Nothing else is stored.

INPUT ARCHITECTURE: games read ESA.Controls.vector(slot) (normalized move)
and receive game.onAction(slot, "action1"). Keyboard and the touch joystick
are providers; a future CPU registers one more. Registry entries declare
  touch: { movement: "joystick"|"none", actions: [{id, label}],
           interaction: "directTap", help: [...] }
Files: js/controls.js, js/touch.js, css/touch.css.

Controls belong to the PLAYER SLOT, not the character:
   P1  W A S D (move)  ·  A S D (Bonk Booth)  ·  Space = select / confirm
   P2  Arrow keys      ·  J K L (Bonk Booth)  ·  Enter = select / confirm
   Character select is SELECT -> CONFIRM -> LOCKED IN: the first press,
   click or tap only previews a fighter; Confirm (or the select key again)
   locks in; Change / moving / tapping another fighter / Back cancels the
   preview. Mouse and touch pick for P1 first, then P2.
   Roster grids (Casual + Who's Playing) use explicit column counts on
   touch: phone portrait 3, tablet portrait 4, phone landscape 6, tablet
   landscape 3 (Casual) / 6 (Who's Playing). Desktop keeps its fitted grid.
   Menu art (VS, select panels, Final, Champion) is framed from the trim data
   so every fighter stands at the same height in every browser; optional
   per-character  ui: { scale, offsetX, offsetY }  in js/characters.js tunes
   menu art only (never gameplay).
   Air Hockey: P1 Space = dash, P2 Enter = dash (ESA.CONTROLS[slot].action)


ADDING A NEW GAME
-----------------
Write the game file, call ESA.Games.register({...}) at its bottom (see the
header of js/registry.js for the contract) and add a <script> tag in
index.html before js/app.js. A game whose format changes per mode can add
forContext(context) -> { mode, hud }; the game itself reads api.context. The Game Library and the Tournament draw pick
it up automatically. Set tournamentEligible: false to keep it out of the
draw.


GAMES
-----
1) Bomb Pass          First to 3 rounds         P1 WASD  /  P2 Arrows
2) Coin Rush          60 seconds (can tie)      P1 WASD  /  P2 Arrows
3) Bonk Booth         42 seconds (can tie)      P1 A S D /  P2 J K L
                      +1 correct hole, -1 wrong hole / empty booth, -2 bomb;
                      one attempt per pop-up (mashing loses); speeds up
                      over the round. Scores can go negative.
4) Air Hockey         First to 5 / Tournament: first to 3 OR 90 s
                                                P1 WASD+Space / P2 Arrows+Enter

TOURNAMENT AIR HOCKEY CLOCK: 1:30 of LIVE play only (frozen during the
kickoff countdown, goal celebrations, pause and banners). First to 3 wins
early; at 0:00 the leader wins; a tie goes to SUDDEN DEATH - next goal
wins, no clock, every power-up effect cleared and no new pickups.

AIR HOCKEY: the characters ARE the mallets. Everyone shares one circular
collider (MALLET_R) no matter how wide their art is; the sprite is drawn
at a standard size on top of it. Each player is locked to their own half.
Conceding swaps to the hurt sprite until the faceoff. Power-ups spawn
near the centre line (one at a time, every 15-22 s of play) and always
hit the OPPONENT of whoever grabs them:
   SMACK               a random OTHER ESA member runs in: 3.0 s stun
   GARA EH YA AMR??!!  speech-bubble meltdown: 3.0 s stun
   SHRINK              sprite AND collider drop to 58% for 7.0 s
   REVERSE             movement keys inverted for 7.0 s (dash key unchanged)
The same effect never stacks or extends. When an effect ends naturally the
player gets 2.0 s of status immunity (pickups aimed at them show IMMUNE!).
A goal clears every effect. The match context passes the target score,
so Tournament Mode reuses the same game with first-to-3.


POWER-UPS (shared, for movement games)
--------------------------------------
js/status-effects.js  ESA.StatusEffects: per-player stunned / shrunk /
                      reversed + immunity, on a caller-supplied clock.
js/powerups.js        ESA.PowerUps: pickup types, spawner, and Session
                      (spawn, pickup, targeting, cameo/bubble, status pills).
Opt in with  powerUps: { enabled: true, types: [...] }  in the registry
entry and ESA.PowerUps.createSession(config, { players, spawn, ... }) in
the game (returns null when disabled). The game supplies one adapter per
player (getAnchor, getReach, showHurtSprite, restoreNormalSprite, nudge,
onStatusChange) and reads isStunned / isReversed / colliderScale /
visualScale. No timers: the session clock only advances in update(), so
pause freezes every effect and destroy() leaves nothing behind. See the
header of js/powerups.js. Games without power-ups simply omit the field.


TOURNAMENT RULES
----------------
2 players: 2 league rounds -> Final.   3: 3 rounds -> Final (top 2).
4-11: 3 rounds -> Semifinals (top 4).  12+: 4 rounds -> Quarterfinals (top 8).
Win 3, tie 1, loss 0, bye 3 (a bye counts as a win so everyone finishes the
league with the same number of results). Tiebreaks: points, wins, score
difference, then drawn lots. Pairings avoid rematches; byes rotate. Every
round plays one drawn game; the previous round's game is excluded and less
played games are favoured. Knockout ties are replayed.


BRANDING
--------
The official emblem lives at:
    assets/Branding/Golden Canadian Pharaoh Emblem.png

It is used as-is (never redrawn or recoloured) on the title screen, the
arcade menu header, the Bonk Booth marquee, the arena floor watermark, the
result screen draw state, and as the Coin Rush collectible. Coin Rush
pre-renders it once into a small offscreen canvas at startup rather than
rescaling the 1254px source every frame.


FILE MAP
--------
index.html              Every screen, shared SVG symbols, global chrome.
css/tokens.css          Design tokens, reset, buttons, key caps.
css/arcade.css          Shell, ambient, shutter transition, welcome,
                        intro, play screen, HUD, countdown, results.
css/menus.css           Top bar/BACK, bezel, CRT, mode select, character
                        select, VS, game library, modals, mascot.
css/tournament.css      All tournament screens.

js/core.js              Utilities, pausable TimerGroup, Audio, Input,
                        Assets, veil transitions, particle pool.
js/characters.js        CHARACTER REGISTRY, slot controls, movement, sprites.
js/registry.js          GAME REGISTRY.
js/arena.js             ESA.Stage (canvas) and ESA.UI (HUD, results).
js/bombpass.js          Game 1.        js/coinrush.js   Game 2.
js/bonkbooth.js         Game 3.        js/airhockey.js  Game 4.
js/controls.js          ESA.Controls: normalized input from keyboard / touch / (future CPU).
js/touch.js             ESA.Touch: touch mode, joystick + buttons (multitouch),
                        rotate-to-play, Control Setup, saved preferences.
css/touch.css           Touch controls, compact touch HUD, short-screen menus.
js/status-effects.js    Shared status effects (stun / shrink / reverse / immunity).
js/powerups.js          Shared power-ups: types, spawner, per-match Session.
js/tournament.js        Tournament manager (pure logic, no DOM).
js/app.js               State machine, modal stack, BACK, pause, the single
                        game loop and run lifecycle.
js/menus.js             Welcome, mode, character select, VS, library, intro.
js/tournament-ui.js     Tournament screens and result recording.
js/attract.js           Idle attract mode + emblem mascot (menus only).
js/main.js              Boot.

_backup_v1/             The original V1 files. Safe to delete.


ARCHITECTURE NOTES
------------------
One game at a time. Every entry into a match goes through the play screen
in app.js and every exit through teardownRun(), which cancels the animation
frame, clears the game's TimerGroup, wipes particles, resets screen FX and
drops all held keys. Repeated play / back / rematch cycles cannot leave a
loop or timer behind.

One animation loop. app.js owns the only requestAnimationFrame, and it only
runs while a match exists. Each run has a token, so a stale game can never
report a result, and results are recorded once (run guard + tournament
guard). Screen timers live in App.timers, cleared on every screen change.

One key handler. ESA.Input installs a single keydown/keyup pair and exposes
one replaceable onPress slot, so handlers cannot stack. Held keys clear on
blur, visibilitychange and pagehide.

Game state machines. Each game tracks idle / countdown / playing / roundEnd
/ matchEnd / destroyed. Movement and scoring only run during "playing",
which is what prevents scoring during a countdown, double explosions,
double round results and duplicate token pickups.

Fixed coordinate system. The arena is always 960x540 logical units
regardless of window size, so movement speeds never depend on resolution.
The canvas backing store scales with devicePixelRatio (capped at 2) for
crisp text on high-DPI laptops.

Static arena art is rendered once into an offscreen canvas and blitted,
so detailed floors cost one drawImage per frame.


AUDIO
-----
All sound is synthesised with WebAudio. The project ships with zero audio
files and zero licensing questions, and the game is fully playable muted.

Sounds are called through named hooks, e.g. ESA.Audio.play("tokenPickup").
To swap in real samples later, register a file for that hook at startup:

    ESA.Audio.register("tokenPickup", "assets/sfx/token.wav");

Registered files take priority; anything unregistered falls back to the
synth. Existing hook names: uiHover, uiClick, uiBack, start, countdown, go,
tokenPickup, tokenBonus, bombPass, bombTick, bombTickHot, explosion, bonk,
bonkMiss, penalty, roundWin, matchWin, draw, puckHit, puckWall, goal,
powerSpawn, gara, shrink, reverse.


TUNING
------
Movement speeds and match lengths are constants at the top of each game
file. V2 speeds are roughly 23% below V1 on purpose - these games are meant
to be playable by people who do not play video games.

    bombpass.js   PLAYER_SPEED 180, FUSE_MIN/MAX 10-18, WINS_NEEDED 3
    coinrush.js   PLAYER_SPEED 185, MATCH_SECONDS 60, TOKEN_COUNT 7
    bonkbooth.js  MATCH_SECONDS 42, CURVE (early -> late value of every
                  stage: gap, tell, rise, active, retreat, stun, bomb
                  chance), LATE_GRACE_RISE. (stun is how long a bonked rival
                  is held up showing their hurt art - shorten it and the
                  payoff stops reading)

    airhockey.js  TARGETS (casual 5 / tournament 3), MOVE_SPEED 290,
                  DASH_* (cooldown 1.7 s), PUCK_MAX 980, PUCK_DRAG.
    powerups.js   SHRINK_SCALE 0.58, durations on each type, spawn 15-22 s.
    status-effects.js  IMMUNITY_MS 2000. neutralMods() is the hook for a future comeback
                  system (speed, dash cooldown, collider radius) - unused today.

Arena bounds live in js/arena.js as ESA.BOUNDS.
