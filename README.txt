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

Controls belong to the PLAYER SLOT, not the character:
   P1  W A S D (move)  ·  A S D (Bonk Booth)  ·  Space = lock in
   P2  Arrow keys      ·  J K L (Bonk Booth)  ·  Enter = lock in


ADDING A NEW GAME
-----------------
Write the game file, call ESA.Games.register({...}) at its bottom (see the
header of js/registry.js for the contract) and add a <script> tag in
index.html before js/app.js. The Game Library and the Tournament draw pick
it up automatically. Set tournamentEligible: false to keep it out of the
draw.


GAMES
-----
1) Bomb Pass          First to 3 rounds         P1 WASD  /  P2 Arrows
2) Coin Rush          60 seconds (can tie)      P1 WASD  /  P2 Arrows
3) Bonk Booth         42 seconds (can tie)      P1 A S D /  P2 J K L


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
js/bonkbooth.js         Game 3.
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
bonkMiss, penalty, roundWin, matchWin, draw.


TUNING
------
Movement speeds and match lengths are constants at the top of each game
file. V2 speeds are roughly 23% below V1 on purpose - these games are meant
to be playable by people who do not play video games.

    bombpass.js   PLAYER_SPEED 180, FUSE_MIN/MAX 10-18, WINS_NEEDED 3
    coinrush.js   PLAYER_SPEED 185, MATCH_SECONDS 60, TOKEN_COUNT 7
    bonkbooth.js  MATCH_SECONDS 42, TELL/RISE/RETREAT/STUN stage durations
                  (STUN is how long a bonked rival is held up showing their
                  hurt art - shorten it and the payoff stops reading)

Arena bounds live in js/arena.js as ESA.BOUNDS.
