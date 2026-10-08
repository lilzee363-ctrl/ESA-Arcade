(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const canvas = $("#gameCanvas");
  const ctx = canvas.getContext("2d");

  const menuScreen = $("#menuScreen");
  const gameScreen = $("#gameScreen");
  const instructionPanel = $("#instructionPanel");
  const canvasWrap = $("#canvasWrap");
  const resultOverlay = $("#resultOverlay");
  const gameTitle = $("#gameTitle");
  const gameHint = $("#gameHint");
  const restartBtn = $("#restartBtn");

  const W = canvas.width;
  const H = canvas.height;
  const keys = Object.create(null);

  const characters = {
    zima: {
      id: "zima",
      name: "Zima",
      normalSrc: "assets/zima_normal.png",
      hurtSrc: "assets/zima_hurt.png",
      color: "#246fca",
      controls: { up: "KeyW", left: "KeyA", down: "KeyS", right: "KeyD" }
    },
    shaza: {
      id: "shaza",
      name: "Shaza",
      normalSrc: "assets/shaza_normal.png",
      hurtSrc: "assets/shaza_hurt.png",
      color: "#72447e",
      controls: { up: "ArrowUp", left: "ArrowLeft", down: "ArrowDown", right: "ArrowRight" }
    }
  };

  const images = {};
  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  async function preload() {
    for (const c of Object.values(characters)) {
      images[c.id + "_normal"] = await loadImage(c.normalSrc);
      images[c.id + "_hurt"] = await loadImage(c.hurtSrc);
    }
  }

  class Sfx {
    constructor() { this.ac = null; }
    ensure() {
      if (!this.ac) this.ac = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ac.state === "suspended") this.ac.resume();
    }
    tone(freq = 440, dur = .08, type = "square", gain = .05, slide = 0) {
      try {
        this.ensure();
        const t = this.ac.currentTime;
        const o = this.ac.createOscillator();
        const g = this.ac.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(.0001, t + dur);
        o.connect(g).connect(this.ac.destination);
        o.start(t); o.stop(t + dur);
      } catch (_) {}
    }
    coin() { this.tone(710, .06, "sine", .05, 260); }
    bonk() { this.tone(165, .09, "square", .07, -60); }
    beep() { this.tone(520, .05, "square", .035); }
    explode() { this.tone(100, .26, "sawtooth", .09, -55); }
    win() { this.tone(520, .08, "square", .05, 200); setTimeout(() => this.tone(780, .13, "square", .05, 250), 90); }
  }
  const sfx = new Sfx();

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rand = (min, max) => min + Math.random() * (max - min);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function arenaBackground(title = "ESA ARCADE") {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#ead9ad");
    g.addColorStop(1, "#c7a76d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(12,39,70,.08)";
    for (let x = 0; x < W; x += 60) {
      ctx.fillRect(x, 82, 2, H - 82);
    }
    for (let y = 82; y < H; y += 58) {
      ctx.fillRect(0, y, W, 2);
    }

    ctx.fillStyle = "#07182c";
    ctx.fillRect(0, 0, W, 78);
    ctx.fillStyle = "#f6c34b";
    ctx.fillRect(0, 76, W, 3);
    ctx.font = "900 25px system-ui";
    ctx.textBaseline = "middle";
    ctx.fillText(title, 26, 39);
  }

  function drawPlayer(p, opts = {}) {
    const isHurt = p.hurtUntil && performance.now() < p.hurtUntil;
    const img = images[p.character.id + (isHurt ? "_hurt" : "_normal")];
    const h = opts.height || 142;
    const ratio = img.width / img.height;
    const w = h * ratio;

    ctx.save();
    ctx.translate(p.x, p.y);
    if (opts.facing === "left") ctx.scale(-1, 1);
    if (isHurt) ctx.rotate(Math.sin(performance.now() / 38) * .045);
    ctx.shadowColor = "rgba(0,0,0,.24)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 7;
    ctx.drawImage(img, -w / 2, -h * .78, w, h);
    ctx.restore();

    ctx.font = "900 15px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(7,24,44,.92)";
    roundedRect(p.x - 43, p.y + 20, 86, 24, 12);
    ctx.fill();
    ctx.fillStyle = "white";
    ctx.fillText(p.character.name.toUpperCase(), p.x, p.y + 24);
    ctx.textAlign = "left";
  }

  function movement(p, dt) {
    const c = p.character.controls;
    let dx = (keys[c.right] ? 1 : 0) - (keys[c.left] ? 1 : 0);
    let dy = (keys[c.down] ? 1 : 0) - (keys[c.up] ? 1 : 0);
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      dx /= len; dy /= len;
      p.x += dx * p.speed * dt;
      p.y += dy * p.speed * dt;
      if (dx < -.1) p.facing = "left";
      if (dx > .1) p.facing = "right";
    }
    p.x = clamp(p.x, 55, W - 55);
    p.y = clamp(p.y, 145, H - 55);
  }

  function hudBox(x, y, w, name, score, color, alignRight = false) {
    ctx.fillStyle = "rgba(6,22,41,.93)";
    roundedRect(x, y, w, 48, 14); ctx.fill();
    ctx.fillStyle = color; ctx.fillRect(alignRight ? x + w - 6 : x, y + 8, 6, 32);
    ctx.fillStyle = "white";
    ctx.font = "900 18px system-ui";
    ctx.textBaseline = "middle";
    ctx.textAlign = alignRight ? "right" : "left";
    ctx.fillText(name.toUpperCase(), alignRight ? x + w - 20 : x + 20, y + 17);
    ctx.fillStyle = "#f6c34b";
    ctx.font = "1000 18px system-ui";
    ctx.fillText(score, alignRight ? x + w - 20 : x + 20, y + 34);
    ctx.textAlign = "left";
  }

  const gameMeta = {
    bomb: {
      title: "BOMB PASS",
      icon: "💣",
      hint: "First to 3 rounds wins",
      text: "The bomb timer is hidden. If you are holding it, touch the other player to pass it. After a pass there is a tiny cooldown, so you cannot instantly pass it back.",
      controls: [["Zima", "W A S D"], ["Shaza", "Arrow Keys"]]
    },
    coin: {
      title: "COIN RUSH",
      icon: "🪙",
      hint: "45 seconds • Gold coin = 3 points",
      text: "Run over coins to collect them. Normal coins are worth 1 point. A rare gold coin is worth 3. Highest score when the timer ends wins.",
      controls: [["Zima", "W A S D"], ["Shaza", "Arrow Keys"]]
    },
    bonk: {
      title: "BONK BOOTH",
      icon: "🔨",
      hint: "30 seconds • Bomb = −1 point",
      text: "A target pops out of one of your three holes. Hit the matching key before it disappears. If a bomb pops up, do NOT hit it.",
      controls: [["Zima", "A  S  D"], ["Shaza", "J  K  L"]]
    }
  };

  let selectedGame = null;
  let currentGame = null;
  let raf = 0;
  let last = 0;
  let gameRunning = false;

  function clearKeys() {
    for (const k of Object.keys(keys)) delete keys[k];
  }

  function showMenu() {
    stopLoop();
    selectedGame = null;
    currentGame = null;
    resultOverlay.classList.add("hidden");
    canvasWrap.classList.add("hidden");
    instructionPanel.classList.add("hidden");
    gameScreen.classList.add("hidden");
    menuScreen.classList.remove("hidden");
    clearKeys();
  }

  function chooseGame(id) {
    selectedGame = id;
    const m = gameMeta[id];
    menuScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    instructionPanel.classList.remove("hidden");
    canvasWrap.classList.add("hidden");
    resultOverlay.classList.add("hidden");
    gameTitle.textContent = m.title;
    gameHint.textContent = m.hint;
    $("#instructionIcon").textContent = m.icon;
    $("#instructionTitle").textContent = m.title;
    $("#instructionText").textContent = m.text;
    $("#instructionControls").innerHTML = m.controls.map(([name, ctl]) => `<div class="control-box"><strong>${name}</strong><span>${ctl}</span></div>`).join("");
  }

  function startSelectedGame() {
    sfx.ensure();
    instructionPanel.classList.add("hidden");
    canvasWrap.classList.remove("hidden");
    resultOverlay.classList.add("hidden");
    clearKeys();
    if (selectedGame === "bomb") currentGame = new BombPass();
    if (selectedGame === "coin") currentGame = new CoinRush();
    if (selectedGame === "bonk") currentGame = new BonkBooth();
    currentGame.start();
    startLoop();
  }

  function restart() {
    if (!selectedGame) return;
    stopLoop();
    startSelectedGame();
  }

  function finishGame(winner, text) {
    gameRunning = false;
    clearKeys();
    $("#resultTitle").textContent = winner ? `${winner.toUpperCase()} WINS!` : "DRAW!";
    $("#resultText").textContent = text;
    resultOverlay.classList.remove("hidden");
    sfx.win();
  }

  function startLoop() {
    cancelAnimationFrame(raf);
    gameRunning = true;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function stopLoop() {
    gameRunning = false;
    cancelAnimationFrame(raf);
    clearKeys();
  }

  function loop(now) {
    if (!currentGame) return;
    const dt = Math.min((now - last) / 1000, .033);
    last = now;
    if (gameRunning) currentGame.update(dt, now);
    currentGame.draw(now);
    raf = requestAnimationFrame(loop);
  }

  class BombPass {
    constructor() {
      this.p1 = { character: characters.zima, x: 230, y: 320, speed: 235, facing: "right", hurtUntil: 0 };
      this.p2 = { character: characters.shaza, x: 730, y: 320, speed: 235, facing: "left", hurtUntil: 0 };
      this.score = { zima: 0, shaza: 0 };
      this.holder = Math.random() < .5 ? this.p1 : this.p2;
      this.passCooldown = 0;
      this.roundState = "playing";
      this.roundWait = 0;
      this.banner = "";
      this.bannerColor = "#fff";
      this.lastBeepBucket = null;
      this.setFuse();
    }
    start() {}
    setFuse() {
      this.fuse = rand(7, 15);
      this.fuseLeft = this.fuse;
      this.lastBeepBucket = null;
    }
    resetRound() {
      this.p1.x = 230; this.p1.y = 320; this.p1.hurtUntil = 0;
      this.p2.x = 730; this.p2.y = 320; this.p2.hurtUntil = 0;
      this.holder = Math.random() < .5 ? this.p1 : this.p2;
      this.passCooldown = .8;
      this.roundState = "playing";
      this.banner = "";
      this.setFuse();
    }
    update(dt, now) {
      if (this.roundState === "roundOver") {
        this.roundWait -= dt;
        if (this.roundWait <= 0) this.resetRound();
        return;
      }
      movement(this.p1, dt);
      movement(this.p2, dt);
      this.passCooldown -= dt;

      const d = dist(this.p1, this.p2);
      if (d < 78 && this.passCooldown <= 0) {
        const old = this.holder;
        this.holder = this.holder === this.p1 ? this.p2 : this.p1;
        this.passCooldown = .75;
        const nx = (this.p2.x - this.p1.x) / Math.max(d, 1);
        const ny = (this.p2.y - this.p1.y) / Math.max(d, 1);
        this.p1.x -= nx * 14; this.p1.y -= ny * 14;
        this.p2.x += nx * 14; this.p2.y += ny * 14;
        if (old !== this.holder) sfx.beep();
      }

      this.fuseLeft -= dt;
      if (this.fuseLeft < 4) {
        const interval = this.fuseLeft < 1.8 ? .28 : this.fuseLeft < 3 ? .48 : .72;
        const bucket = Math.floor(this.fuseLeft / interval);
        if (bucket !== this.lastBeepBucket) { this.lastBeepBucket = bucket; sfx.beep(); }
      }

      if (this.fuseLeft <= 0) {
        const loser = this.holder;
        const winner = loser === this.p1 ? this.p2 : this.p1;
        loser.hurtUntil = now + 1200;
        this.score[winner.character.id]++;
        sfx.explode();
        this.banner = `💥 ${loser.character.name.toUpperCase()} BLEW UP`;
        this.bannerColor = "#ee5b58";
        if (this.score[winner.character.id] >= 3) {
          finishGame(winner.character.name, `${this.score.zima} – ${this.score.shaza} • ${loser.character.name} was holding the bomb.`);
        } else {
          this.roundState = "roundOver";
          this.roundWait = 1.65;
        }
      }
    }
    draw(now) {
      arenaBackground("BOMB PASS");
      hudBox(20, 15, 175, "Zima", `${this.score.zima}/3`, characters.zima.color);
      hudBox(W - 195, 15, 175, "Shaza", `${this.score.shaza}/3`, characters.shaza.color, true);
      ctx.fillStyle = "#f6c34b"; ctx.font = "900 14px system-ui"; ctx.textAlign = "center"; ctx.fillText("HIDDEN FUSE", W / 2, 41); ctx.textAlign = "left";

      // Arena boundary
      ctx.strokeStyle = "rgba(7,24,44,.28)"; ctx.lineWidth = 5;
      roundedRect(22, 102, W - 44, H - 125, 30); ctx.stroke();

      drawPlayer(this.p1, { facing: this.p1.facing });
      drawPlayer(this.p2, { facing: this.p2.facing });

      const h = this.holder;
      const pulse = 1 + Math.sin(now / (this.fuseLeft < 3 ? 80 : 170)) * .08;
      ctx.save();
      ctx.translate(h.x, h.y - 105);
      ctx.scale(pulse, pulse);
      ctx.font = "50px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("💣", 0, 0);
      ctx.restore();
      ctx.textAlign = "left";

      if (this.passCooldown > 0 && this.passCooldown < .58) {
        ctx.fillStyle = "rgba(7,24,44,.7)"; roundedRect(W/2 - 75, H - 53, 150, 30, 15); ctx.fill();
        ctx.fillStyle = "#fff7e4"; ctx.font = "800 13px system-ui"; ctx.textAlign = "center"; ctx.fillText("PASS COOLDOWN", W/2, H - 38); ctx.textAlign = "left";
      }

      if (this.banner) {
        ctx.fillStyle = "rgba(7,24,44,.86)"; roundedRect(W/2 - 220, 103, 440, 58, 16); ctx.fill();
        ctx.fillStyle = this.bannerColor; ctx.font = "1000 25px system-ui"; ctx.textAlign = "center"; ctx.fillText(this.banner, W/2, 138); ctx.textAlign = "left";
      }
    }
  }

  class CoinRush {
    constructor() {
      this.p1 = { character: characters.zima, x: 220, y: 330, speed: 240, facing: "right", hurtUntil: 0 };
      this.p2 = { character: characters.shaza, x: 740, y: 330, speed: 240, facing: "left", hurtUntil: 0 };
      this.score = { zima: 0, shaza: 0 };
      this.timeLeft = 45;
      this.coins = [];
      this.finished = false;
      for (let i = 0; i < 7; i++) this.coins.push(this.newCoin(i === 0));
    }
    start() {}
    newCoin(forceGold = false) {
      return {
        x: rand(70, W - 70), y: rand(135, H - 65),
        gold: forceGold || Math.random() < .13,
        spin: rand(0, Math.PI * 2)
      };
    }
    collect(p, c, index) {
      const value = c.gold ? 3 : 1;
      this.score[p.character.id] += value;
      sfx.coin();
      this.coins[index] = this.newCoin(false);
    }
    update(dt) {
      if (this.finished) return;
      movement(this.p1, dt);
      movement(this.p2, dt);
      this.timeLeft -= dt;

      for (let i = 0; i < this.coins.length; i++) {
        const c = this.coins[i];
        c.spin += dt * 4;
        if (Math.hypot(this.p1.x - c.x, this.p1.y - c.y) < 43) { this.collect(this.p1, c, i); continue; }
        if (Math.hypot(this.p2.x - c.x, this.p2.y - c.y) < 43) { this.collect(this.p2, c, i); }
      }

      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.finished = true;
        if (this.score.zima === this.score.shaza) finishGame(null, `${this.score.zima} – ${this.score.shaza}. Nobody gets bragging rights.`);
        else {
          const winner = this.score.zima > this.score.shaza ? "Zima" : "Shaza";
          finishGame(winner, `Final score: ${this.score.zima} – ${this.score.shaza}.`);
        }
      }
    }
    draw() {
      arenaBackground("COIN RUSH");
      hudBox(20, 15, 190, "Zima", `${this.score.zima} pts`, characters.zima.color);
      hudBox(W - 210, 15, 190, "Shaza", `${this.score.shaza} pts`, characters.shaza.color, true);

      ctx.fillStyle = this.timeLeft <= 10 ? "#ee5b58" : "#f6c34b";
      ctx.font = "1000 26px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`${Math.ceil(this.timeLeft)}s`, W / 2, 39);
      ctx.textAlign = "left";

      ctx.strokeStyle = "rgba(7,24,44,.24)"; ctx.lineWidth = 5;
      roundedRect(22, 102, W - 44, H - 125, 30); ctx.stroke();

      for (const c of this.coins) {
        const r = c.gold ? 18 : 14;
        ctx.save(); ctx.translate(c.x, c.y); ctx.scale(.55 + Math.abs(Math.cos(c.spin)) * .45, 1);
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = c.gold ? "#ffdc55" : "#e7b641"; ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = c.gold ? "#9d6508" : "#aa7a1d"; ctx.stroke();
        ctx.fillStyle = "#fff2a3"; ctx.beginPath(); ctx.arc(-4, -5, r * .28, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        if (c.gold) {
          ctx.fillStyle = "#7a4b04"; ctx.font = "1000 11px system-ui"; ctx.textAlign = "center"; ctx.fillText("+3", c.x, c.y + 4); ctx.textAlign = "left";
        }
      }

      drawPlayer(this.p1, { facing: this.p1.facing });
      drawPlayer(this.p2, { facing: this.p2.facing });

      if (this.timeLeft <= 10 && this.timeLeft > 0) {
        ctx.fillStyle = "rgba(7,24,44,.75)"; roundedRect(W/2 - 140, 102, 280, 44, 14); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "1000 18px system-ui"; ctx.textAlign = "center"; ctx.fillText("FINAL 10 SECONDS!", W/2, 130); ctx.textAlign = "left";
      }
    }
  }

  class BonkBooth {
    constructor() {
      this.score = { zima: 0, shaza: 0 };
      this.timeLeft = 30;
      this.finished = false;
      this.targets = {
        zima: this.makeTarget("zima"),
        shaza: this.makeTarget("shaza")
      };
      this.keyMaps = { zima: ["KeyA", "KeyS", "KeyD"], shaza: ["KeyJ", "KeyK", "KeyL"] };
      this.flash = { zima: "", shaza: "" };
      this.flashUntil = { zima: 0, shaza: 0 };
    }
    start() {}
    makeTarget(side) {
      return {
        side,
        hole: Math.floor(Math.random() * 3),
        type: Math.random() < .12 ? "bomb" : "normal",
        life: rand(.72, 1.14),
        hit: false,
        hitTimer: 0
      };
    }
    hit(side, index) {
      if (this.finished) return;
      const t = this.targets[side];
      if (!t || t.hit || index !== t.hole) {
        this.flash[side] = "MISS";
        this.flashUntil[side] = performance.now() + 280;
        sfx.tone(115, .05, "square", .025);
        return;
      }
      t.hit = true;
      t.hitTimer = .24;
      if (t.type === "bomb") {
        this.score[side] = Math.max(0, this.score[side] - 1);
        this.flash[side] = "💥 -1";
        sfx.explode();
      } else {
        this.score[side] += 1;
        this.flash[side] = "BONK! +1";
        sfx.bonk();
      }
      this.flashUntil[side] = performance.now() + 430;
    }
    keyDown(code) {
      for (const side of ["zima", "shaza"]) {
        const idx = this.keyMaps[side].indexOf(code);
        if (idx >= 0) this.hit(side, idx);
      }
    }
    update(dt) {
      if (this.finished) return;
      this.timeLeft -= dt;
      for (const side of ["zima", "shaza"]) {
        let t = this.targets[side];
        if (t.hit) {
          t.hitTimer -= dt;
          if (t.hitTimer <= 0) this.targets[side] = this.makeTarget(side);
        } else {
          t.life -= dt;
          if (t.life <= 0) this.targets[side] = this.makeTarget(side);
        }
      }
      if (this.timeLeft <= 0) {
        this.timeLeft = 0; this.finished = true;
        if (this.score.zima === this.score.shaza) finishGame(null, `${this.score.zima} – ${this.score.shaza}. Perfectly balanced bonking.`);
        else {
          const winner = this.score.zima > this.score.shaza ? "Zima" : "Shaza";
          finishGame(winner, `Final score: ${this.score.zima} – ${this.score.shaza}.`);
        }
      }
    }
    drawHole(cx, cy, side, idx, target, now) {
      ctx.fillStyle = "rgba(54,35,18,.42)";
      ctx.beginPath(); ctx.ellipse(cx, cy + 35, 88, 28, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#231a15";
      ctx.beginPath(); ctx.ellipse(cx, cy + 31, 76, 20, 0, 0, Math.PI * 2); ctx.fill();

      if (target && target.hole === idx) {
        if (target.type === "bomb") {
          ctx.font = "70px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("💣", cx, cy - 18); ctx.textAlign = "left";
        } else {
          const victim = side === "zima" ? characters.shaza : characters.zima;
          const img = images[victim.id + (target.hit ? "_hurt" : "_normal")];
          const h = 145; const w = h * (img.width / img.height);
          ctx.save();
          ctx.beginPath(); ctx.rect(cx - 82, cy - 125, 164, 160); ctx.clip();
          ctx.drawImage(img, cx - w / 2, cy - 116, w, h);
          ctx.restore();
        }
      }

      const labels = side === "zima" ? ["A", "S", "D"] : ["J", "K", "L"];
      ctx.fillStyle = side === "zima" ? "#246fca" : "#72447e";
      roundedRect(cx - 22, cy + 61, 44, 34, 10); ctx.fill();
      ctx.fillStyle = "white"; ctx.font = "1000 18px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(labels[idx], cx, cy + 78); ctx.textAlign = "left";
    }
    draw(now) {
      arenaBackground("BONK BOOTH");
      ctx.fillStyle = "#f6c34b"; ctx.font = "1000 26px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(`${Math.ceil(this.timeLeft)}s`, W/2, 39); ctx.textAlign = "left";
      hudBox(20, 15, 190, "Zima", `${this.score.zima} pts`, characters.zima.color);
      hudBox(W - 210, 15, 190, "Shaza", `${this.score.shaza} pts`, characters.shaza.color, true);

      ctx.fillStyle = "rgba(7,24,44,.1)"; ctx.fillRect(W/2 - 2, 102, 4, H - 122);
      ctx.font = "900 18px system-ui"; ctx.textAlign = "center"; ctx.fillStyle = "#07182c"; ctx.fillText("ZIMA'S SIDE", W/4, 125); ctx.fillText("SHAZA'S SIDE", W*3/4, 125);

      const y = 310;
      const leftXs = [125, 275, 425];
      const rightXs = [535, 685, 835];
      for (let i = 0; i < 3; i++) this.drawHole(leftXs[i], y, "zima", i, this.targets.zima, now);
      for (let i = 0; i < 3; i++) this.drawHole(rightXs[i], y, "shaza", i, this.targets.shaza, now);

      for (const side of ["zima", "shaza"]) {
        if (now < this.flashUntil[side]) {
          const x = side === "zima" ? W/4 : W*3/4;
          const good = this.flash[side].includes("+1");
          ctx.fillStyle = good ? "#0f7b48" : "#a83333";
          roundedRect(x - 80, 455, 160, 40, 12); ctx.fill();
          ctx.fillStyle = "white"; ctx.font = "1000 18px system-ui"; ctx.textAlign = "center"; ctx.fillText(this.flash[side], x, 480); ctx.textAlign = "left";
        }
      }
    }
  }

  document.querySelectorAll(".game-card").forEach(btn => btn.addEventListener("click", () => chooseGame(btn.dataset.game)));
  $("#startBtn").addEventListener("click", startSelectedGame);
  $("#backBtn").addEventListener("click", showMenu);
  $("#resultBackBtn").addEventListener("click", showMenu);
  $("#rematchBtn").addEventListener("click", restart);
  restartBtn.addEventListener("click", restart);

  window.addEventListener("keydown", (e) => {
    if (!gameRunning || resultOverlay.classList.contains("hidden") === false) return;
    const gameKeys = ["KeyW","KeyA","KeyS","KeyD","ArrowUp","ArrowLeft","ArrowDown","ArrowRight","KeyJ","KeyK","KeyL"];
    if (gameKeys.includes(e.code)) e.preventDefault();
    if (!keys[e.code]) {
      keys[e.code] = true;
      if (currentGame && typeof currentGame.keyDown === "function") currentGame.keyDown(e.code);
    }
  }, { passive: false });

  window.addEventListener("keyup", (e) => { delete keys[e.code]; });
  window.addEventListener("blur", clearKeys);
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearKeys(); });

  preload().catch(() => {}).finally(showMenu);
})();
