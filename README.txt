ESA ARCADE - V2
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


TODAY'S ROSTER
--------------
- Zima
- Shaza

The roster is data driven in js/characters.js. Adding a future ESA member
means adding one object to ESA.characters, appending the id to ESA.roster,
and dropping in a matching normal/hurt image pair. No game file hard-codes
a character name.


GAMES
-----
1) Bomb Pass          First to 3 rounds
   Zima: W A S D      Shaza: Arrow Keys
   Touch your opponent to pass the bomb. The fuse is hidden (10-18s).
   Don't be holding it when it blows.

2) Coin Rush          60 seconds
   Zima: W A S D      Shaza: Arrow Keys
   Collect ESA emblem tokens. Normal = 1 point, rare glowing token = 3.

3) Bonk Booth         42 seconds
   Zima: A S D        Shaza: J K L
   Your rival pops out of your three holes. Hit the matching key.
   Bombs cost you a point - leave them alone.


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
index.html            All four screens plus the shared SVG icon symbols.
css/tokens.css        Design tokens, reset, typography, buttons, panels.
css/arcade.css        Screens, HUD, countdown, banners, result, transitions.

js/core.js            Utilities, TimerGroup, Audio, Input, Assets,
                      screen transitions, particle pool.
js/characters.js      Roster data, movement, sprite animation.
js/arena.js           ESA.Stage (canvas renderer, screen FX, arena art)
                      and ESA.UI (HUD, countdown, banners, result).
js/bombpass.js        Game 1.
js/coinrush.js        Game 2.
js/bonkbooth.js       Game 3.
js/main.js            Boot, flow, the single animation loop.

_backup_v1/           The original V1 files, kept because this folder is
                      not under version control. Safe to delete.


ARCHITECTURE NOTES
------------------
One game at a time. Every entry into a match goes through startRun() in
main.js and every exit through teardownRun(), which cancels the animation
frame, clears the game's TimerGroup, wipes particles, resets screen FX and
drops all held keys. Repeated play / back / rematch cycles cannot leave a
loop or timer behind.

One animation loop. main.js owns the only requestAnimationFrame.

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
