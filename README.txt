ESA ARCADE - V4
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
Welcome -> Mode Select -> CASUAL, SOLO or TOURNAMENT

Casual:     Character Select -> VS -> Game Library -> Intro -> Match ->
            Results (Rematch / Game Library / Change Players)
Solo:       Your Fighter (Normal / Evil / Guest) -> Solo Game, then
            VS CPU (Air Hockey, Bomb Pass): CPU Difficulty -> VS -> Intro ->
              Match -> WIN / LOSS / DRAW (Rematch / Change Difficulty /
              Change Character / Solo Game Select / Session Stats /
              Back to Arcade)
            SCORE ATTACK (Coin Rush, Bonk Booth): Intro -> one-player run ->
              RUN COMPLETE: score + session best (Retry / Change Character /
              Solo Game Select / Session Stats / Back to Arcade)
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

MIRROR SAFETY: art with readable text / numbers / logos must not be
flipped. Add  mirrorSafe: false  (or { normal: true, hurt: false }) to the
registry entry; ESA.drawSprite and the side-flipping menu art (P2 select
panel, VS, Final) then leave it unflipped and rely on placement. Evil
variants inherit the rule; Guests default to safe. Presentation only.
Currently unsafe: Zima (both), Amr (both), Adam (both), Lama (normal),
Gneady (hurt), Ahmood (hurt).

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
  Entering a game how-to card with PLAY / CONTROLS / BACK, already inside
                  the landscape game (auto-starts after 6 s).
  Gameplay        a FULL-SCREEN LANDSCAPE game, without turning the phone.
                  Phone upright: body.vland rotates ONLY the gameplay layers
                  (play screen, touch controls, pause menu, how-to card) into
                  a landscape box covering the whole screen; touches are
                  inverse-mapped into it (Touch.localPoint). Phone turned
                  anyway: the real landscape viewport is used, nothing is
                  rotated - never a double rotation. Menus stay portrait.
                  Page scroll is locked during play. Viewport size is measured
                  live (Safari bars), safe areas are remapped. Android also
                  gets fullscreen + landscape lock on Start.
  HUD             one bar, every block the same height: pause | P1 face name
                  score | centre (FIRST TO 5 / time) | score name face P2 |
                  gear. Solo adds a tiny YOU / CPU - HARD line.
  Controls        compact translucent joystick that floats to your thumb
                  anywhere on your half, plus action buttons where needed.
  Air Hockey      joystick + DASH          Coin Rush / Bomb Pass  joystick only
  Bonk Booth      tap the holes directly - head-to-head layout, each player
                  owns one half of the screen.
  Controls setup  gear button, pause menu or how-to card: drag controls,
                  Size, Visibility, Swap, Reset. P1 and P2 each have their
                  own layout and zone.

Solo shows ONE control set, tagged YOU: Air Hockey joystick + DASH, Bomb
Pass / Coin Rush joystick only, Bonk Booth direct taps. No dead P2 widgets.

Stale pointers: a widget never stays owned by a finger that is gone (iOS
Safari can swallow a pointerup). A new finger always takes a widget over,
a primary touch releases anything still held, window-level pointerup /
pointercancel / touchend release wherever the event lands, and resize,
orientation change, blur, page hide, visibility change, pause, resume,
restart and exit release everything. See STALE POINTERS in js/touch.js.

Control preferences live in localStorage key "esaArcade.touchControls.v1"
(positions normalized 0..1, sizes, opacity). Nothing else is stored.

INPUT ARCHITECTURE: games read ESA.Controls.vector(slot) (normalized move)
and receive game.onAction(slot, "action1"). Keyboard and the touch joystick
are providers; a Solo CPU (js/cpu.js) is one more, and claims its
slot so the arrow keys / Enter can't steer it. Registry entries declare
  touch: { movement: "joystick"|"none", actions: [{id, label}],
           interaction: "directTap", help: [...] }
Files: js/controls.js, js/touch.js, css/touch.css.

MOVEMENT IS STATE: keys update held state immediately (keydown/keyup;
auto-repeat only re-asserts a held key, it never moves anyone); the one game
loop reads ESA.Controls.vector() every frame. Four held directions combine
and opposing keys on the same axis resolve LAST PRESSED WINS (hold A, press
D = right at once; release D with A still down = left again), independently
for left/right and up/down; the result is normalised so diagonals are never
faster. The touch joystick is full 360
degree analog: 7% dead zone, full speed at half the remaining travel, an
ease-out curve so short flicks are already fast, and the knob is drawn at
exactly the magnitude the game receives. In Solo the arrow keys and Enter
also drive the human (setKeyboardAlias). DASH and other presses are the only
one-shot inputs. Air Hockey mallet response: see ACCEL / OVERSPEED / REVERSE
/ TURN / BRAKE at the top of js/airhockey.js (top speed unchanged).

Controls belong to the PLAYER SLOT, not the character:
   P1  W A S D (move)  ·  A S D (Bonk Booth)  ·  Space = select / confirm
   P2  Arrow keys      ·  J K L (Bonk Booth)  ·  Enter = select / confirm
   Character select is SELECT -> CONFIRM -> LOCKED IN: the first press,
   click or tap only previews a fighter; Confirm (or the select key again)
   locks in; moving / tapping another fighter / Back changes or drops the
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
                      Every real pass adds +1.0 s to the fuse (capped at
                      the round's starting fuse); one contact = one pass
                      (the pair must separate before the next). Visible fuse
                      ring + seconds badge. OVERTIME: past its starting fuse
                      a round burns up to x2 faster, so trading can't stall.
2) Coin Rush          60 seconds (can tie)      P1 WASD  /  P2 Arrows
                      +3 token lives 6.5 s (draining ring). SPEED BOOTS
                      x1.35 for 5 s, MAGNET 170 px pull for 6 s (both refresh,
                      never stack), TRAPS 7 s on the floor -> 4.0 s stun.
                      Versus: pickups / traps spawn about equidistant from
                      both players. Solo: the tokens move.
3) Bonk Booth         42 seconds (can tie)      P1 A S D /  P2 J K L
                      +1 target, -1 empty hole / too late, -2 bomb. One
                      SHARED schedule feeds both players (same bombs, same
                      chances). Up to 2 targets at once, an occasional 3rd
                      late; the glow cue fades out. No lockout after a miss.
                      CLUTCH (versus): 4+ / 8+ points behind = +9% / +14%
                      reaction window on normal targets. Solo: arrows / J K L
                      also work. Scores can go negative.
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
near the centre line (one at a time, every 9-14 s of play; a shuffle bag
means never the same type twice in a row, even across rematches) and always
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
css/solo.css            Solo screens, mode row, Session Stats, Solo result.

js/core.js              Utilities, pausable TimerGroup, Audio, Input,
                        Assets, veil transitions, particle pool.
js/characters.js        CHARACTER REGISTRY, slot controls, movement, sprites.
js/registry.js          GAME REGISTRY.
js/arena.js             ESA.Stage (canvas) and ESA.UI (HUD, results).
js/bombpass.js          Game 1.        js/coinrush.js   Game 2.
js/bonkbooth.js         Game 3.        js/airhockey.js  Game 4.
js/controls.js          ESA.Controls: normalized input from keyboard / touch / CPU,
                        plus slot ownership (claim / release).
js/cpu.js               ESA.CPU: generic CPU controller + difficulty list.
js/cpu-airhockey.js     Air Hockey CPU strategy.
js/cpu-bombpass.js      Bomb Pass CPU strategy.
js/dash.js              ESA.Dash: shared directional dash + keyboard double-tap.
js/clutch.js            ESA.Clutch: opt-in comeback assist (Bonk Booth).
js/quality.js           ESA.Quality: adaptive decoration tiers, ?perf overlay.
js/solo-stats.js        ESA.SoloStats: Versus record + Score Attack (sessionStorage).
js/solo.js              Solo screens, CPU opponent pick, Solo results.
js/touch.js             ESA.Touch: touch mode, joystick + buttons (multitouch),
                        stale-pointer recovery, rotate-to-play card, portrait
                        fallback, Control Setup, saved preferences.
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

    bombpass.js   PLAYER_SPEED 180, FUSE_MIN/MAX 10-18, WINS_NEEDED 3,
                  PASS_BONUS 1.0, REARM_DIST, OVERTIME_RAMP 8, ESA.SMOOTH_MOVE
    coinrush.js   PLAYER_SPEED 185, MATCH_SECONDS 60, TOKEN_COUNT 7,
                  BONUS_LIFE 6.5, DRIFT_*, BOOTS_*, MAGNET_*, TRAP_*
    bonkbooth.js  MATCH_SECONDS 42 (Solo SOLO_SECONDS 50), CURVE (early -> late value of every
                  stage: interval, tell, rise, active, retreat, stun, bomb
                  chance, cue), maxActive(), CLUTCH, LATE_GRACE_RISE. (stun
                  is how long a bonked rival is held up showing their hurt
                  art - shorten it and the payoff stops reading)

    airhockey.js  TARGETS (casual 5 / tournament 3), MOVE_SPEED 290,
                  DASH_* (cooldown 1.7 s), PUCK_MAX 1068 (was 980),
                  HIT_SPEED_BOOST 1.09, PUCK_DRAG.
    powerups.js   SHRINK_SCALE 0.58, durations on each type (Air Hockey
                  spawns them every 9-14 s).
    status-effects.js  IMMUNITY_MS 2000.
    clutch.js     shared opt-in comeback assist (only Bonk Booth uses it).
    dash.js       DOUBLE_TAP_MS 250 (shared directional dash).
    cpu.js        PROFILES: the shared Easy / Normal / Hard decision quality.
    quality.js    adaptive decoration tiers (high / medium / low).

Arena bounds live in js/arena.js as ESA.BOUNDS.


SOLO MODE (one player on the device)
------------------------------------
Every current game is playable in Solo. Each registry entry declares
  soloEligible: true, soloModeType: "cpu-versus" | "score-attack"
and the Solo game select labels its card VS CPU or SCORE ATTACK.

VS CPU (Air Hockey, Bomb Pass). The human is P1 (W A S D + Space / touch
joystick + DASH). The CPU is a CPU participant ("cpu-bomb-hard-03", never a
participant-NN id) on P2, drawn as a random permanent roster character
(Normal 3x as likely as Evil; never your exact character + variant).
Difficulty (Easy / Normal / Hard) changes DECISION QUALITY only - reaction
and decision speed, prediction, aim / route error, mistakes, how fast it
notices a pickup. Every difficulty attacks, defends, takes pickups and
dashes; every CPU moves at exactly the human's speed with the human's
acceleration, dash and cooldown (shared profile in js/cpu.js). Air Hockey:
first to 5, no clock, same power-ups and physics. Bomb Pass: first to 3
rounds, same proximity hand-off, no pass button.

SCORE ATTACK (Coin Rush 60 s, Bonk Booth 50 s). One player, no CPU, no
difficulty, no P2 controls. The game reads context.single and ends with
result.score. Coin Rush thins the floor (7 -> 5 tokens) and drops tokens
further away as the run goes on; Bonk Booth is one centred booth where
random ESA members pop up, on the same early -> late curve and scoring
(+1 / empty hole -1 / bomb -2 / nothing 0). Coin Rush tokens drift around
the arena in Solo, so you have to chase them.

A new CPU-versus game: (1) expose observe(slot, view) - what a player can
see, (2) ESA.CPU.registerStrategy(id, { create }), (3) soloEligible +
soloModeType "cpu-versus". soloPool() requires the strategy, so no game can
fake a CPU. A new Score Attack game (e.g. ESA Slice): honour
context.single and report result.score - Session Stats needs no changes.

The CPU only outputs a stick vector and DASH presses through
ESA.Controls, so the game applies speed caps, the centre line, dash
cooldown, STUN (no input), SHRINK and REVERSE to it exactly as to a human.
The strategy never sees hidden state (spawn timers, RNG) and is not told
it is reversed, so it can't compensate.

SESSION STATS: sessionStorage "esaArcade.soloStats.v1" (survives refresh,
gone with the tab; never localStorage). Two separate records:
  VERSUS RECORD  overall / per difficulty / per game / per human
                 participant W-D-L, win rate, current + best win streak (a
                 draw neither extends nor breaks it), HARD CPU DEFEATED (+1
                 for any CPU-versus WIN on Hard - Air Hockey or Bomb Pass).
  SCORE ATTACK   per game: attempts, latest score, best this session.
                 Never touches W-D-L, streaks or Hard CPU Defeated.
Only completed matches / runs count; every Solo start gets a unique
matchId and the recorder refuses a repeat, so results count exactly once.


V4.1 NOTES (performance + guests)
---------------------------------
Adaptive quality: js/quality.js averages real frame time of the game loop
over 3 s windows; 2 slow windows step DOWN a tier, 5 fast windows (and
30 s since the last change) step back UP. It only trims decoration
(sprite shadowBlur, particle counts, puck trail, idle glows, canvas
resolution cap, menu ambience) - never input, physics, timers or CPU.
index.html?perf shows FPS / frame time / tier / RAF callbacks per frame;
?quality=low|medium|high pins a tier.
Inactive screens pause their CSS animations; the game loop stops ~2.6 s
after a result appears (and repaints once on resize).

Guest face photo ("Use My Photo" in the Guest creator): chosen / taken on
the device, framed in a round crop, resized locally to a 256x256 JPEG and
masked into the guest's head. Never uploaded; kept in the session only
(sessionStorage while small, otherwise memory) and never in localStorage.
Replace / Remove live in the Customize step.
