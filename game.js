(() => {
  "use strict";

  const canvas = document.getElementById("court");
  const ctx = canvas.getContext("2d");
  const W = 960;
  const H = 540;
  const FLOOR = 462;
  const NET_X = 480;
  const NET_TOP = 335;
  const WALL_L = 42;
  const WALL_R = 918;
  const GRAVITY = 920;
  const WIN_SCORE = 7;
  const TAU = Math.PI * 2;

  const $ = (id) => document.getElementById(id);
  const overlays = ["menuOverlay", "setupOverlay", "howOverlay", "pauseOverlay", "resultOverlay"];
  const keySet = new Set();
  const pressed = new Set();
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;

  const players = {
    sam: { name: "Top Hat Sam", kind: "sam", accent: "#f2efe5", body: "#111416", head: "#f6f2e8" },
    red: { name: "The Red Dude", kind: "red", accent: "#ef3940", body: "#101314", head: "#ef3940" },
    robot: { name: "Robotron", kind: "robot", accent: "#3fa6c4", body: "#162b31", head: "#9fd6df" }
  };

  const confetti = Array.from({ length: 130 }, (_, i) => ({
    x: 54 + ((i * 83) % 850),
    y: 47 + ((i * 47) % 278),
    size: i % 7 === 0 ? 4 : 3,
    color: ["#e55b5c", "#e2c34d", "#4b9bb5", "#bd69a5", "#75b77b", "#e6e0c9"][i % 6],
    alpha: .34 + (i % 4) * .08,
    phase: i * .37
  }));

  const grainDots = Array.from({ length: 900 }, (_, i) => ({
    x: (i * 97) % W,
    y: (i * 53) % 423,
    a: .025 + ((i * 11) % 7) * .008
  }));

  let audioContext = null;
  let muted = false;
  let lastTime = 0;
  let rafId = 0;

  const state = {
    screen: "menu",
    mode: "exhibition",
    score: [0, 0],
    round: 0,
    rally: 0,
    serveSide: 0,
    serveTimer: 0,
    pointPause: 0,
    pointWinner: null,
    toast: "",
    toastTimer: 0,
    matchWinner: null,
    aiSkill: .86,
    playerChoice: "sam",
    opponentChoice: "red",
    players: [],
    shuttle: null,
    particles: [],
    clock: 0,
    matchConfig: null,
    flash: 0
  };

  function createPlayer(side, choice, human) {
    const info = players[choice] || players.sam;
    return {
      side,
      x: side === 0 ? 205 : 755,
      homeX: side === 0 ? 205 : 755,
      y: FLOOR,
      vy: 0,
      speed: 255,
      onGround: true,
      swing: 0,
      swingCooldown: 0,
      hitCooldown: 0,
      hasHitSwing: false,
      moveBlend: 0,
      facing: side === 0 ? 1 : -1,
      human,
      choice,
      info,
      name: info.name,
      scoreFlash: 0
    };
  }

  function createShuttle() {
    return { x: state.serveSide === 0 ? 249 : 711, y: FLOOR - 111, vx: 0, vy: 0, lastHit: -1, age: 0, trail: [], netHit: false };
  }

  function showOnly(id) {
    overlays.forEach((name) => $(name).classList.toggle("visible", name === id));
  }

  function hideOverlays() {
    overlays.forEach((name) => $(name).classList.remove("visible"));
  }

  function setStatus(value) {
    $("statusLabel").textContent = value;
  }

  function updateScoreHud() {
    $("scoreLabel").textContent = state.score[0] + " — " + state.score[1];
    $("modeLabel").textContent = state.mode === "local" ? "2 PLAYER" : "EXHIBITION";
  }

  function beep(type = "hit") {
    if (muted) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") audioContext.resume();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      const config = type === "point"
        ? { start: 190, end: 580, duration: .19, volume: .065 }
        : type === "swing"
          ? { start: 330, end: 160, duration: .055, volume: .028 }
          : { start: 240, end: 100, duration: .08, volume: .038 };
      osc.type = "square";
      osc.frequency.setValueAtTime(config.start, now);
      osc.frequency.exponentialRampToValueAtTime(config.end, now + config.duration);
      gain.gain.setValueAtTime(config.volume, now);
      gain.gain.exponentialRampToValueAtTime(.0001, now + config.duration);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(now);
      osc.stop(now + config.duration);
    } catch (_) {}
  }

  function showToast(text, duration = 1) {
    state.toast = text;
    state.toastTimer = duration;
  }

  function openSetup(mode) {
    state.mode = mode;
    $("setupTitle").textContent = mode === "local" ? "2 PLAYER" : "EXHIBITION";
    $("difficultySetup").style.display = mode === "local" ? "none" : "";
    $("opponentSetup").querySelector("span").textContent = mode === "local" ? "PLAYER 2" : "OPPONENT";
    $("opponentSelect").innerHTML = mode === "local"
      ? '<option value="red">The Red Dude</option><option value="sam">Top Hat Sam</option><option value="robot">Robotron</option>'
      : '<option value="red">The Red Dude</option><option value="sam">Top Hat Sam</option><option value="robot">Robotron</option>';
    showOnly("setupOverlay");
  }

  function menu() {
    state.screen = "menu";
    state.matchWinner = null;
    state.toast = "";
    setStatus("READY");
    updateScoreHud();
    showOnly("menuOverlay");
  }

  function startMatch() {
    const playerChoice = $("playerSelect").value;
    const opponentChoice = $("opponentSelect").value;
    state.mode = state.mode === "local" ? "local" : "exhibition";
    state.playerChoice = playerChoice;
    state.opponentChoice = opponentChoice;
    state.aiSkill = Number($("difficultySelect").value) || .86;
    state.score = [0, 0];
    state.round = 0;
    state.rally = 0;
    state.pointWinner = null;
    state.pointPause = 0;
    state.matchWinner = null;
    state.players = [
      createPlayer(0, playerChoice, true),
      createPlayer(1, opponentChoice, state.mode === "local")
    ];
    state.screen = "match";
    state.serveSide = 0;
    state.shuttle = createShuttle();
    state.serveTimer = 1.05;
    state.flash = 0;
    updateScoreHud();
    hideOverlays();
    setStatus("SERVE");
    showToast("READY", .8);
    canvas.focus();
    beep("point");
  }

  function restartMatch() {
    if (state.matchConfig) {
      $("playerSelect").value = state.matchConfig.player;
      $("opponentSelect").value = state.matchConfig.opponent;
      if (state.matchConfig.mode === "local") state.mode = "local";
      else state.mode = "exhibition";
    }
    startMatch();
  }

  function finishMatch() {
    state.screen = "result";
    state.matchWinner = state.score[0] >= WIN_SCORE ? 0 : 1;
    $("resultTitle").textContent = state.matchWinner === 0 ? "YOU WIN" : "YOU LOSE";
    $("resultTitle").style.color = state.matchWinner === 0 ? "var(--red)" : "#b9c2bd";
    $("resultPlayerScore").textContent = state.score[0];
    $("resultOpponentScore").textContent = state.score[1];
    $("resultCopy").textContent = state.matchWinner === 0 ? "A clean exhibition win." : "The next rally is yours.";
    $("resultKicker").textContent = state.mode === "local" ? "MATCH COMPLETE" : "EXHIBITION COMPLETE";
    showOnly("resultOverlay");
    setStatus(state.matchWinner === 0 ? "WINNER" : "DEFEAT");
    beep("point");
    burst(state.matchWinner === 0 ? 180 : 110, state.matchWinner === 0 ? "#ef3940" : "#6c8584");
  }

  function resetRally(winner) {
    state.round += 1;
    state.rally = 0;
    state.serveSide = winner;
    state.shuttle = createShuttle();
    state.serveTimer = .92;
    state.pointPause = 0;
    state.flash = .17;
    state.players[0].x = 205;
    state.players[1].x = 755;
    state.players.forEach((p) => {
      p.y = FLOOR; p.vy = 0; p.swing = 0; p.swingCooldown = 0; p.hitCooldown = 0; p.onGround = true;
    });
  }

  function scorePoint(winner) {
    if (state.screen !== "match" || state.pointPause > 0) return;
    state.score[winner] += 1;
    state.pointWinner = winner;
    state.pointPause = .95;
    state.rally = 0;
    state.shuttle.vx = 0;
    state.shuttle.vy = 0;
    state.shuttle.trail = [];
    updateScoreHud();
    setStatus(winner === 0 ? "POINT P1" : "POINT P2");
    showToast(winner === 0 ? "POINT  P1" : "POINT  P2", .86);
    burst(state.shuttle.x, FLOOR - 8, winner === 0 ? "#ef3940" : "#3ea6c4");
    beep("point");
    if (state.score[winner] >= WIN_SCORE) {
      window.setTimeout(finishMatch, 680);
    }
  }

  function startRallyIfReady(dt) {
    if (state.pointPause > 0) {
      state.pointPause -= dt;
      if (state.pointPause <= 0 && state.score[0] < WIN_SCORE && state.score[1] < WIN_SCORE) {
        resetRally(state.pointWinner ?? 0);
        setStatus("SERVE");
      }
      return true;
    }
    if (state.serveTimer > 0) {
      state.serveTimer -= dt;
      if (state.serveTimer <= 0) serve();
      return true;
    }
    return false;
  }

  function serve() {
    const server = state.players[state.serveSide];
    const direction = server.side === 0 ? 1 : -1;
    state.shuttle.x = server.x + direction * 40;
    state.shuttle.y = server.y - 95;
    state.shuttle.vx = direction * 350;
    state.shuttle.vy = -510;
    state.shuttle.lastHit = server.side;
    state.shuttle.age = 0;
    state.rally = 1;
    setStatus("RALLY");
    showToast("PLAY", .52);
    beep("hit");
  }

  function isDown(...keys) {
    return keys.some((key) => keySet.has(key));
  }

  function actionFor(player, action) {
    if (player.side === 0) {
      if (action === "left") return ["a"];
      if (action === "right") return ["d"];
      if (action === "jump") return ["w"];
      if (action === "swing") return ["s", " "];
    }
    if (action === "left") return ["ArrowLeft"];
    if (action === "right") return ["ArrowRight"];
    if (action === "jump") return ["ArrowUp"];
    if (action === "swing") return ["ArrowDown"];
    return [];
  }

  function playerActionDown(player, action) {
    return isDown(...actionFor(player, action));
  }

  function jump(player) {
    if (player.onGround && player.swingCooldown <= 0) {
      player.vy = -455;
      player.onGround = false;
      player.moveBlend = Math.max(player.moveBlend, .45);
      beep("swing");
    }
  }

  function requestSwing(player) {
    if (player.swingCooldown > 0 || state.screen !== "match" || state.serveTimer > 0 || state.pointPause > 0) return;
    player.swing = .24;
    player.swingCooldown = .25;
    player.hasHitSwing = false;
    beep("swing");
    attemptHit(player);
  }

  function updateHuman(player, dt) {
    const left = playerActionDown(player, "left");
    const right = playerActionDown(player, "right");
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    player.vx = dir * player.speed;
    if (dir) player.facing = dir;
    player.x += player.vx * dt;
    const limits = player.side === 0 ? [76, 438] : [522, 884];
    player.x = clamp(player.x, limits[0], limits[1]);
    player.moveBlend = lerp(player.moveBlend, Math.abs(dir), .23);
    if (playerActionDown(player, "jump") && player.onGround) jump(player);
  }

  function predictedXForAI(shuttle, player) {
    if (!shuttle || shuttle.x < NET_X || shuttle.vx < 0) return player.homeX;
    const target = clamp(shuttle.x + shuttle.vx * .35, 540, 884);
    return target;
  }

  function updateAI(player, dt) {
    const shuttle = state.shuttle;
    const ownSide = shuttle.x > NET_X - 8;
    let target = ownSide ? predictedXForAI(shuttle, player) : player.homeX;
    if (shuttle.x > NET_X && shuttle.vx < 0) target = clamp(shuttle.x - 34, 540, 884);
    const reaction = .52 + state.aiSkill * .7;
    const distance = target - player.x;
    const dir = Math.abs(distance) > 10 ? Math.sign(distance) : 0;
    player.vx = dir * player.speed * reaction;
    if (dir) player.facing = dir;
    player.x += player.vx * dt;
    player.x = clamp(player.x, 522, 884);
    player.moveBlend = lerp(player.moveBlend, Math.abs(dir), .18);

    const reachable = Math.abs(shuttle.x - player.x) < 78 && shuttle.y < player.y - 37 && shuttle.y > player.y - 188;
    if (ownSide && reachable && shuttle.vy > -180 && Math.random() < (state.aiSkill * 1.5 + dt * 3)) requestSwing(player);
    if (ownSide && shuttle.y < player.y - 130 && Math.abs(shuttle.x - player.x) < 108 && player.onGround && state.aiSkill > .74 && Math.random() < dt * 6) jump(player);
    if (ownSide && shuttle.y > player.y - 78 && Math.abs(shuttle.x - player.x) < 80 && player.onGround && Math.random() < dt * 2) jump(player);
  }

  function updatePlayerPhysics(player, dt) {
    player.y += player.vy * dt;
    player.vy += GRAVITY * dt;
    if (player.y >= FLOOR) {
      player.y = FLOOR;
      player.vy = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }
    player.swing = Math.max(0, player.swing - dt);
    player.swingCooldown = Math.max(0, player.swingCooldown - dt);
    player.hitCooldown = Math.max(0, player.hitCooldown - dt);
    player.scoreFlash = Math.max(0, player.scoreFlash - dt);
    if (player.swing > 0 && !player.hasHitSwing) attemptHit(player);
  }

  function attemptHit(player) {
    const s = state.shuttle;
    if (!s || player.hitCooldown > .2 || state.serveTimer > 0 || state.pointPause > 0) return false;
    const ownSide = player.side === 0 ? s.x < NET_X + 28 : s.x > NET_X - 28;
    const directionToPlayer = player.side === 0 ? s.vx < 110 : s.vx > -110;
    const idealY = player.y - 105;
    const dx = Math.abs(s.x - player.x);
    const dy = Math.abs(s.y - idealY);
    const canReach = dx < 82 && dy < 87 && s.y < player.y - 29;
    if (!ownSide || !canReach || !directionToPlayer || s.lastHit === player.side) return false;

    const heightBoost = clamp((player.y - s.y) / 130, 0, 1);
    const jumpBoost = player.onGround ? 0 : .2;
    const timing = 1 - clamp((dx / 82 + dy / 87) * .5, 0, 1);
    const quality = clamp(timing + jumpBoost * .35, .18, 1);
    const direction = player.side === 0 ? 1 : -1;
    const baseSpeed = 350 + quality * 190 + (player.choice === "robot" ? 22 : 0);
    s.vx = direction * baseSpeed;
    s.vy = -430 - quality * 180 - jumpBoost * 110;
    s.lastHit = player.side;
    s.age = 0;
    player.hasHitSwing = true;
    s.netHit = false;
    state.rally += 1;
    state.flash = .11;
    player.hitCooldown = .22;
    showToast(quality > .72 ? "SMASH!" : "HIT", .42);
    burst(s.x, s.y, quality > .72 ? "#f7e7c0" : "#f2a7a2", 4);
    beep("hit");
    return true;
  }

  function updateShuttle(dt) {
    const s = state.shuttle;
    if (!s || state.serveTimer > 0 || state.pointPause > 0) return;
    s.age += dt;
    s.trail.unshift({ x: s.x, y: s.y, life: 1 });
    if (s.trail.length > 8) s.trail.pop();
    s.trail.forEach((p) => p.life -= dt * 4.5);
    s.vy += GRAVITY * dt;
    const prevX = s.x;
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    if (s.x < WALL_L) { s.x = WALL_L; s.vx = Math.abs(s.vx) * .88; s.netHit = false; }
    if (s.x > WALL_R) { s.x = WALL_R; s.vx = -Math.abs(s.vx) * .88; s.netHit = false; }

    if ((prevX - NET_X) * (s.x - NET_X) < 0 && s.y > NET_TOP + 5) {
      s.x = NET_X + (s.x > prevX ? 4 : -4);
      s.vx *= -.25;
      s.vy *= .15;
      s.netHit = true;
      beep("hit");
    }

    if (s.y >= FLOOR - 2) {
      scorePoint(s.x < NET_X ? 1 : 0);
    }
  }

  function burst(x, y, color, count = 18) {
    for (let i = 0; i < count; i++) {
      state.particles.push({
        x, y, vx: rand(-150, 150), vy: rand(-340, -80), life: rand(.35, .9), size: rand(2, 5), color
      });
    }
  }

  function updateParticles(dt) {
    state.particles.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 480 * dt; p.life -= dt; });
    state.particles = state.particles.filter((p) => p.life > 0);
  }

  function update(dt) {
    state.clock += dt;
    state.toastTimer = Math.max(0, state.toastTimer - dt);
    state.flash = Math.max(0, state.flash - dt);
    updateParticles(dt);
    if (state.screen !== "match") return;
    if (state.pointPause > 0) { startRallyIfReady(dt); return; }
    if (state.serveTimer > 0) { startRallyIfReady(dt); return; }
    for (const player of state.players) {
      if (player.human) updateHuman(player, dt);
      else updateAI(player, dt);
      updatePlayerPhysics(player, dt);
    }
    updateShuttle(dt);
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawBackground() {
    const wall = ctx.createLinearGradient(0, 0, 0, 430);
    wall.addColorStop(0, "#707a79");
    wall.addColorStop(.52, "#687270");
    wall.addColorStop(1, "#535c5b");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, 425);

    ctx.fillStyle = "rgba(18, 23, 23, .12)";
    ctx.fillRect(0, 0, 11, 425);
    ctx.fillRect(W - 11, 0, 11, 425);
    ctx.strokeStyle = "rgba(20, 26, 26, .27)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(45, 0); ctx.lineTo(45, 426); ctx.moveTo(915, 0); ctx.lineTo(915, 426); ctx.stroke();

    grainDots.forEach((dot) => {
      ctx.fillStyle = "rgba(30, 40, 39, " + dot.a + ")";
      ctx.fillRect(dot.x, dot.y, 1, 1);
    });
    confetti.forEach((f) => {
      ctx.globalAlpha = f.alpha + Math.sin(state.clock * .8 + f.phase) * .06;
      ctx.fillStyle = f.color;
      ctx.fillRect(f.x, f.y, f.size, f.size);
    });
    ctx.globalAlpha = 1;

    const floor = ctx.createLinearGradient(0, 419, 0, H);
    floor.addColorStop(0, "#d29d56");
    floor.addColorStop(.34, "#c8904d");
    floor.addColorStop(1, "#ae743b");
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.moveTo(108, 419); ctx.lineTo(852, 419); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 419, W, H - 419); ctx.clip();
    for (let y = 429; y < H; y += 18) {
      ctx.strokeStyle = "rgba(84, 48, 22, .18)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + 8); ctx.stroke();
    }
    for (let x = -120; x < 1080; x += 70) {
      ctx.strokeStyle = "rgba(255, 225, 158, .09)";
      ctx.beginPath(); ctx.moveTo(480 + (x - 480) * .42, 419); ctx.lineTo(x, H); ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(87, 48, 22, .72)";
    ctx.lineWidth = 3;
    ctx.setLineDash([9, 12]);
    ctx.beginPath();
    ctx.moveTo(423, 420); ctx.lineTo(345, H);
    ctx.moveTo(537, 420); ctx.lineTo(615, H);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(247, 215, 153, .35)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(108, 419); ctx.lineTo(852, 419); ctx.stroke();
  }

  const segments = {
    "0": ["a", "b", "c", "d", "e", "f"],
    "1": ["b", "c"],
    "2": ["a", "b", "g", "e", "d"],
    "3": ["a", "b", "c", "d", "g"],
    "4": ["f", "g", "b", "c"],
    "5": ["a", "f", "g", "c", "d"],
    "6": ["a", "f", "g", "e", "c", "d"],
    "7": ["a", "b", "c"],
    "8": ["a", "b", "c", "d", "e", "f", "g"],
    "9": ["a", "b", "c", "d", "f", "g"],
    "-": ["g"]
  };

  function drawDigit(ch, x, y, scale = 1) {
    const active = segments[ch] || [];
    const w = 19 * scale;
    const h = 34 * scale;
    const t = 4 * scale;
    const parts = {
      a: [x + t, y, x + w - t, y],
      b: [x + w, y + t, x + w, y + h / 2 - t],
      c: [x + w, y + h / 2 + t, x + w, y + h - t],
      d: [x + t, y + h, x + w - t, y + h],
      e: [x, y + h / 2 + t, x, y + h - t],
      f: [x, y + t, x, y + h / 2 - t],
      g: [x + t, y + h / 2, x + w - t, y + h / 2]
    };
    ctx.lineCap = "round";
    ctx.lineWidth = t;
    active.forEach((name) => {
      const p = parts[name];
      ctx.strokeStyle = "#f0323b";
      ctx.shadowColor = "rgba(244, 28, 37, .8)";
      ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[2], p[3]); ctx.stroke();
    });
    ctx.shadowBlur = 0;
    return w + 10 * scale;
  }

  function drawScoreboard() {
    ctx.save();
    ctx.fillStyle = "#050607";
    ctx.strokeStyle = "#252a2a";
    ctx.lineWidth = 3;
    roundRect(382, 18, 196, 60, 3); ctx.fill(); ctx.stroke();
    const text = String(state.score[0]) + "-" + String(state.score[1]);
    const totalW = text.split("").reduce((n, ch) => n + (ch === "-" ? 23 : 29), 0);
    let x = 480 - totalW / 2;
    for (const ch of text) {
      x += drawDigit(ch, x, 31, ch === "-" ? .9 : 1);
    }
    ctx.restore();
  }

  function drawNet() {
    ctx.save();
    ctx.strokeStyle = "#2789aa";
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(NET_X - 17, NET_TOP + 2); ctx.lineTo(NET_X - 17, FLOOR + 1); ctx.moveTo(NET_X + 17, NET_TOP + 2); ctx.lineTo(NET_X + 17, FLOOR + 1); ctx.stroke();
    ctx.strokeStyle = "#40b4d0";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(NET_X - 17, NET_TOP + 2); ctx.lineTo(NET_X + 17, NET_TOP + 2); ctx.lineTo(NET_X + 17, FLOOR); ctx.stroke();
    ctx.strokeStyle = "rgba(245,248,236,.82)";
    ctx.lineWidth = 1;
    for (let x = NET_X - 15; x <= NET_X + 15; x += 5) {
      ctx.beginPath(); ctx.moveTo(x, NET_TOP + 4); ctx.lineTo(x, FLOOR - 1); ctx.stroke();
    }
    for (let y = NET_TOP + 12; y < FLOOR; y += 9) {
      ctx.beginPath(); ctx.moveTo(NET_X - 16, y); ctx.lineTo(NET_X + 16, y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawShadow(player) {
    const height = FLOOR - player.y;
    ctx.save();
    ctx.globalAlpha = .2 * (1 - clamp(height / 130, 0, .72));
    ctx.fillStyle = "#1c2826";
    ctx.beginPath();
    ctx.ellipse(player.x, FLOOR + 2, 23 + height * .06, 5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawRacket(player, swing) {
    const side = player.side === 0 ? 1 : -1;
    const baseX = player.x + side * 22;
    const baseY = player.y - 86;
    let angle = side === 1 ? -.88 : Math.PI + .88;
    if (swing) angle += side === 1 ? .7 : -.7;
    const handX = baseX + side * (swing ? 8 : 0);
    const handY = baseY + (swing ? -8 : 2);
    ctx.save();
    ctx.strokeStyle = "#b8c0bc";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(handX, handY); ctx.lineTo(handX + Math.cos(angle) * 43, handY + Math.sin(angle) * 43); ctx.stroke();
    ctx.translate(handX + Math.cos(angle) * 60, handY + Math.sin(angle) * 60);
    ctx.rotate(angle + Math.PI / 2);
    ctx.strokeStyle = "#dfe3da";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 0, 13, 28, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "rgba(207,218,211,.58)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-8, -17); ctx.lineTo(8, 17); ctx.moveTo(8, -17); ctx.lineTo(-8, 17); ctx.moveTo(0, -20); ctx.lineTo(0, 20); ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(player) {
    const info = player.info;
    const bob = player.onGround ? Math.sin(state.clock * 8 + player.side * 1.3) * (1.3 + player.moveBlend * 2) : 0;
    const bodyY = player.y + bob;
    const jumpHeight = FLOOR - player.y;
    const side = player.side === 0 ? 1 : -1;
    const walk = Math.sin(state.clock * 13 + player.side) * player.moveBlend;
    const swing = player.swing > 0;
    drawShadow(player);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = info.body;
    ctx.fillStyle = info.body;
    ctx.lineWidth = 5;
    const headX = player.x;
    const headY = bodyY - 121;
    const shoulderY = bodyY - 90;
    const hipY = bodyY - 50;
    ctx.beginPath(); ctx.moveTo(headX, shoulderY); ctx.lineTo(headX, hipY); ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(headX, hipY); ctx.lineTo(headX - 13 + walk * 6, bodyY - 1);
    ctx.moveTo(headX, hipY); ctx.lineTo(headX + 13 - walk * 6, bodyY - 1);
    ctx.stroke();

    const armX = headX + side * 4;
    const armY = shoulderY + 3;
    ctx.lineWidth = 4;
    if (swing) {
      ctx.beginPath(); ctx.moveTo(armX, armY); ctx.lineTo(headX + side * 33, shoulderY - 25); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(headX - side * 3, armY + 1); ctx.lineTo(headX - side * 27, shoulderY + 24); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(armX, armY); ctx.lineTo(headX + side * 30, shoulderY - 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(headX - side * 3, armY + 1); ctx.lineTo(headX - side * 26, shoulderY + 18); ctx.stroke();
    }

    ctx.fillStyle = info.head;
    ctx.strokeStyle = info.body;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(headX, headY, 17, 0, TAU); ctx.fill(); ctx.stroke();

    if (info.kind === "sam") {
      ctx.fillStyle = "#0c0f10";
      ctx.fillRect(headX - 19, headY - 26, 38, 6);
      ctx.fillRect(headX - 13, headY - 44, 26, 18);
      ctx.fillRect(headX - 17, headY - 46, 34, 4);
      ctx.fillStyle = "#111416";
      ctx.beginPath(); ctx.arc(headX + side * 6, headY - 1, 2.2, 0, TAU); ctx.fill();
    } else if (info.kind === "red") {
      ctx.fillStyle = "#d42d3a";
      ctx.beginPath(); ctx.arc(headX - 9, headY - 9, 12, Math.PI * .95, Math.PI * 1.95); ctx.fill();
      ctx.beginPath(); ctx.arc(headX + 7, headY - 13, 10, Math.PI * 1.08, Math.PI * 1.93); ctx.fill();
      ctx.fillStyle = "#f7f0e8";
      ctx.beginPath(); ctx.arc(headX + side * 6, headY - 1, 2, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = "#143844";
      ctx.fillRect(headX - 14, headY - 19, 28, 8);
      ctx.strokeStyle = "#8ee7ef";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(headX - 9, headY - 15); ctx.lineTo(headX + 9, headY - 15); ctx.stroke();
      ctx.fillStyle = "#143844";
      ctx.beginPath(); ctx.arc(headX + side * 6, headY - 1, 2.5, 0, TAU); ctx.fill();
    }

    if (info.kind === "robot") {
      ctx.strokeStyle = info.accent;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(headX - 12, headY + 13); ctx.lineTo(headX + 12, headY + 13); ctx.stroke();
    } else if (info.kind === "red") {
      ctx.strokeStyle = info.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(headX + side * 5, headY + 5); ctx.lineTo(headX + side * 10, headY + 7); ctx.stroke();
    }
    drawRacket(player, swing);
    if (!player.onGround && jumpHeight > 50) {
      ctx.globalAlpha = .32;
      ctx.strokeStyle = info.accent;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(player.x, player.y - 65, 29, Math.PI * .1, Math.PI * .9); ctx.stroke();
    }
    ctx.restore();
  }

  function drawShuttle() {
    const s = state.shuttle;
    if (!s) return;
    s.trail.forEach((p, i) => {
      if (p.life <= 0) return;
      ctx.globalAlpha = p.life * .25;
      ctx.fillStyle = "#f3c1bb";
      ctx.beginPath(); ctx.arc(p.x, p.y, 3 - i * .18, 0, TAU); ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(s.x, s.y);
    const angle = Math.atan2(s.vy, s.vx || 1);
    ctx.rotate(angle);
    ctx.fillStyle = "#ef8584";
    ctx.strokeStyle = "#fff1df";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2, -4); ctx.lineTo(-19, -11); ctx.lineTo(-19, 11); ctx.closePath(); ctx.fillStyle = "#f5eee0"; ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#c9d1c9";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-7, -4); ctx.lineTo(-18, -7); ctx.moveTo(-7, 4); ctx.lineTo(-18, 7); ctx.stroke();
    ctx.restore();
  }

  function drawParticles() {
    state.particles.forEach((p) => {
      ctx.globalAlpha = clamp(p.life * 1.7, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    ctx.globalAlpha = 1;
  }

  function drawToast() {
    if (state.toastTimer <= 0 || !state.toast) return;
    const alpha = clamp(state.toastTimer * 2.5, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.font = "800 28px Impact, Haettenschweiler, Arial Narrow, sans-serif";
    ctx.fillStyle = "#fffdf1";
    ctx.strokeStyle = "rgba(20,24,24,.68)";
    ctx.lineWidth = 5;
    ctx.strokeText(state.toast, NET_X, 172);
    ctx.fillText(state.toast, NET_X, 172);
    ctx.restore();
  }

  function drawScene() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawScoreboard();
    drawNet();
    drawPlayer(state.players[0] || createPlayer(0, "sam", true));
    drawPlayer(state.players[1] || createPlayer(1, "red", false));
    drawShuttle();
    drawParticles();
    drawToast();
    if (state.flash > 0) {
      ctx.fillStyle = "rgba(255,248,215," + (state.flash * .45) + ")";
      ctx.fillRect(0, 0, W, H);
    }
  }

  function togglePause() {
    if (state.screen === "match") {
      state.screen = "pause";
      showOnly("pauseOverlay");
      setStatus("PAUSED");
    } else if (state.screen === "pause") {
      state.screen = "match";
      hideOverlays();
      setStatus(state.serveTimer > 0 ? "SERVE" : "RALLY");
      canvas.focus();
    }
  }

  function exitToMenu() {
    state.screen = "menu";
    hideOverlays();
    showOnly("menuOverlay");
    setStatus("READY");
  }

  function normalizeKey(key, code) {
    if (code === "Space") return " ";
    return key.length === 1 ? key.toLowerCase() : key;
  }

  window.addEventListener("keydown", (event) => {
    const key = normalizeKey(event.key, event.code);
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(key)) event.preventDefault();
    if (key === "p" && !event.repeat) { togglePause(); return; }
    if (key === "m" && !event.repeat) {
      muted = !muted;
      $("connectionLight").innerHTML = "<i></i> " + (muted ? "MUTED" : "LOCAL PLAY");
      if (!muted) beep("swing");
      return;
    }
    if (key === "Escape" && !event.repeat) {
      if (state.screen === "match" || state.screen === "pause") exitToMenu();
      else menu();
      return;
    }
    if (event.repeat) return;
    keySet.add(key);
    pressed.add(key);
    if (state.screen === "match" && state.serveTimer <= 0 && state.pointPause <= 0) {
      if (["w"].includes(key)) jump(state.players[0]);
      if (["s", " "].includes(key)) {
        requestSwing(state.players[0]);
      }
      if (state.mode === "local" && key === "ArrowUp") jump(state.players[1]);
      if (state.mode === "local" && key === "ArrowDown") requestSwing(state.players[1]);
    }
  });
  window.addEventListener("keyup", (event) => keySet.delete(normalizeKey(event.key, event.code)));
  window.addEventListener("blur", () => keySet.clear());

  document.querySelectorAll(".touch-controls button").forEach((button) => {
    const map = { left: "a", right: "d", jump: "w", swing: " " };
    const key = map[button.dataset.key];
    const down = (event) => {
      event.preventDefault();
      if (button.dataset.key === "jump") jump(state.players[0]);
      if (button.dataset.key === "swing") requestSwing(state.players[0]);
      keySet.add(key);
    };
    const up = (event) => { event.preventDefault(); keySet.delete(key); };
    button.addEventListener("pointerdown", down);
    ["pointerup", "pointercancel", "pointerleave"].forEach((name) => button.addEventListener(name, up));
  });

  $("exhibitionBtn").addEventListener("click", () => openSetup("exhibition"));
  $("localBtn").addEventListener("click", () => openSetup("local"));
  $("howBtn").addEventListener("click", () => showOnly("howOverlay"));
  $("howBack").addEventListener("click", menu);
  $("setupBack").addEventListener("click", menu);
  $("howStartBtn").addEventListener("click", () => openSetup("exhibition"));
  $("startMatchBtn").addEventListener("click", () => {
    state.matchConfig = { mode: state.mode, player: $("playerSelect").value, opponent: $("opponentSelect").value };
    startMatch();
  });
  $("resumeBtn").addEventListener("click", togglePause);
  $("pauseExitBtn").addEventListener("click", exitToMenu);
  $("rematchBtn").addEventListener("click", restartMatch);
  $("resultMenuBtn").addEventListener("click", menu);
  $("fullscreenBtn").addEventListener("click", () => {
    const frame = document.querySelector(".game-frame");
    if (!document.fullscreenElement) frame.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  state.players = [createPlayer(0, "sam", true), createPlayer(1, "red", false)];
  state.shuttle = createShuttle();
  updateScoreHud();
  setStatus("READY");

  function loop(time) {
    const dt = Math.min(.033, (time - lastTime) / 1000 || .016);
    lastTime = time;
    update(dt);
    drawScene();
    rafId = requestAnimationFrame(loop);
  }

  drawScene();
  rafId = requestAnimationFrame(loop);
  window.addEventListener("beforeunload", () => cancelAnimationFrame(rafId));
})();
