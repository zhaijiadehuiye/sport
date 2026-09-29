(() => {
  "use strict";

  const canvas = document.getElementById("court");
  const ctx = canvas.getContext("2d");
  const W = 960;
  const H = 540;
  const FLOOR = 462;
  const NET_X = 480;
  const NET_TOP = 334;
  const NET_HEIGHT = FLOOR - NET_TOP;
  const WALL_L = 42;
  const WALL_R = 918;
  const GRAVITY = 1220;
  const JUMP_GRAVITY = 1700;
  const SHUTTLE_DRAG = 0.82;
  const SHUTTLE_VERTICAL_DRAG = 0.14;
  const WIN_SCORE = 7;
  const TAU = Math.PI * 2;

  const $ = (id) => document.getElementById(id);
  const keys = new Set();
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const approach = (value, target, amount) => {
    if (value < target) return Math.min(value + amount, target);
    if (value > target) return Math.max(value - amount, target);
    return target;
  };

  const players = {
    sam: { name: "Top Hat Sam", kind: "sam", accent: "#f1e9d1", body: "#101417", head: "#f3ecdd" },
    red: { name: "The Red Dude", kind: "red", accent: "#f33f48", body: "#101417", head: "#e93b45" },
    robot: { name: "Robotron", kind: "robot", accent: "#55c0d4", body: "#142b32", head: "#9bdce3" }
  };

  const confetti = Array.from({ length: 130 }, (_, i) => ({
    x: 54 + ((i * 83) % 850),
    y: 47 + ((i * 47) % 278),
    size: i % 7 === 0 ? 4 : 3,
    color: ["#e55b5c", "#e2c34d", "#4b9bb5", "#bd69a5", "#75b77b", "#e6e0c9"][i % 6],
    alpha: .28 + (i % 4) * .08,
    phase: i * .37
  }));

  const grainDots = Array.from({ length: 900 }, (_, i) => ({
    x: (i * 97) % W,
    y: (i * 53) % 423,
    a: .022 + ((i * 11) % 7) * .008
  }));

  const state = {
    screen: "menu",
    mode: "exhibition",
    score: [0, 0],
    serveSide: 0,
    serveTimer: 0,
    pointPause: 0,
    pointWinner: null,
    matchWinner: null,
    rally: 0,
    toast: "",
    toastTimer: 0,
    aiSkill: .96,
    playerChoice: "sam",
    opponentChoice: "red",
    players: [],
    shuttle: null,
    particles: [],
    hitFx: [],
    clock: 0,
    matchConfig: null,
    flash: 0,
    lastTime: 0
  };

  let audioContext = null;
  let muted = false;
  let rafId = 0;

  function createPlayer(side, choice, human) {
    const info = players[choice] || players.sam;
    return {
      side,
      x: side === 0 ? 205 : 755,
      y: 0,
      vy: 0,
      vx: 0,
      maxSpeed: 375,
      acceleration: 2700,
      friction: 3100,
      jumpSpeed: 720,
      onGround: true,
      swingTime: 0,
      swingDuration: .27,
      swingContacted: false,
      swingCooldown: 0,
      hitCooldown: 0,
      facing: side === 0 ? 1 : -1,
      human,
      choice,
      info,
      name: info.name,
      moveBlend: 0,
      tapLeft: 0,
      tapRight: 0,
      aiSeed: side * 2.71 + Math.random() * 6,
      aiThink: 0,
      scoreFlash: 0
    };
  }

  function createShuttle() {
    return {
      x: state.serveSide === 0 ? 250 : 710,
      h: 128,
      vx: 0,
      vh: 0,
      lastX: 250,
      lastH: 128,
      lastHit: -1,
      age: 0,
      trail: [],
      netHit: false,
      hitFlash: 0,
      rotation: 0
    };
  }

  function showOnly(id) {
    ["menuOverlay", "setupOverlay", "howOverlay", "pauseOverlay", "resultOverlay"]
      .forEach((name) => $(name).classList.toggle("visible", name === id));
  }

  function hideOverlays() {
    ["menuOverlay", "setupOverlay", "howOverlay", "pauseOverlay", "resultOverlay"]
      .forEach((name) => $(name).classList.remove("visible"));
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
          : type === "smash"
            ? { start: 520, end: 110, duration: .095, volume: .052 }
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

  function menu() {
    state.screen = "menu";
    state.matchWinner = null;
    state.toast = "";
    setStatus("READY");
    updateScoreHud();
    showOnly("menuOverlay");
  }

  function openSetup(mode) {
    state.mode = mode;
    $("setupTitle").textContent = mode === "local" ? "2 PLAYER" : "EXHIBITION";
    $("difficultySetup").style.display = mode === "local" ? "none" : "";
    $("opponentSetup").querySelector("span").textContent = mode === "local" ? "PLAYER 2" : "OPPONENT";
    showOnly("setupOverlay");
  }

  function startMatch() {
    state.mode = state.mode === "local" ? "local" : "exhibition";
    state.playerChoice = $("playerSelect").value;
    state.opponentChoice = $("opponentSelect").value;
    state.aiSkill = Number($("difficultySelect").value) || .96;
    state.score = [0, 0];
    state.rally = 0;
    state.pointWinner = null;
    state.pointPause = 0;
    state.matchWinner = null;
    state.players = [
      createPlayer(0, state.playerChoice, true),
      createPlayer(1, state.opponentChoice, state.mode === "local")
    ];
    state.screen = "match";
    state.serveSide = 0;
    state.shuttle = createShuttle();
    state.serveTimer = .72;
    state.flash = 0;
    state.particles = [];
    state.hitFx = [];
    updateScoreHud();
    hideOverlays();
    setStatus("SERVE");
    showToast("READY", .72);
    canvas.focus();
    beep("point");
  }

  function restartMatch() {
    if (state.matchConfig) {
      $("playerSelect").value = state.matchConfig.player;
      $("opponentSelect").value = state.matchConfig.opponent;
      state.mode = state.matchConfig.mode;
    }
    startMatch();
  }

  function finishMatch() {
    if (state.screen === "result") return;
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
    burst(state.matchWinner === 0 ? 480 : 720, FLOOR - 100, state.matchWinner === 0 ? "#ef3940" : "#6c8584", 150);
  }

  function resetRally(winner) {
    state.serveSide = winner;
    state.shuttle = createShuttle();
    state.serveTimer = .64;
    state.pointPause = 0;
    state.flash = .15;
    state.players.forEach((p, side) => {
      p.x = side === 0 ? 205 : 755;
      p.y = 0;
      p.vy = 0;
      p.vx = 0;
      p.swingTime = 0;
      p.swingCooldown = 0;
      p.hitCooldown = 0;
      p.onGround = true;
    });
  }

  function scorePoint(winner) {
    if (state.screen !== "match" || state.pointPause > 0) return;
    state.score[winner] += 1;
    state.pointWinner = winner;
    state.pointPause = .92;
    state.rally = 0;
    state.shuttle.vx = 0;
    state.shuttle.vh = 0;
    state.shuttle.trail = [];
    updateScoreHud();
    setStatus(winner === 0 ? "POINT P1" : "POINT P2");
    showToast(winner === 0 ? "POINT  P1" : "POINT  P2", .86);
    burst(state.shuttle.x, FLOOR - 8, winner === 0 ? "#ef3940" : "#3ea6c4", 26);
    beep("point");
    if (state.score[winner] >= WIN_SCORE) window.setTimeout(finishMatch, 650);
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
    const s = state.shuttle;
    s.x = server.x + direction * 42;
    s.h = 142;
    s.vx = direction * 690;
    s.vh = 650;
    s.lastHit = server.side;
    s.age = 0;
    s.trail = [];
    s.netHit = false;
    setStatus("RALLY");
    showToast("PLAY", .45);
    beep("hit");
  }

  function held(player, action) {
    if (player.side === 0) {
      if (action === "left") return keys.has("KeyA") || keys.has("a");
      if (action === "right") return keys.has("KeyD") || keys.has("d");
      if (action === "jump") return keys.has("KeyW") || keys.has("w");
      if (action === "swing") return keys.has("KeyS") || keys.has("s") || keys.has("Space") || keys.has(" ");
    } else {
      if (action === "left") return keys.has("ArrowLeft");
      if (action === "right") return keys.has("ArrowRight");
      if (action === "jump") return keys.has("ArrowUp");
      if (action === "swing") return keys.has("ArrowDown");
    }
    return false;
  }

  function jump(player) {
    if (!player || !player.onGround || player.swingCooldown > 0 || state.screen !== "match") return;
    player.vy = player.jumpSpeed;
    player.onGround = false;
    player.moveBlend = Math.max(player.moveBlend, .55);
    beep("swing");
  }

  function beginSwing(player) {
    if (!player || state.screen !== "match" || state.serveTimer > 0 || state.pointPause > 0) return false;
    if (player.swingTime > 0 || player.swingCooldown > 0) return false;
    player.swingTime = player.swingDuration;
    player.swingCooldown = .23;
    player.swingContacted = false;
    beep("swing");
    return true;
  }

  function updateHuman(player, dt) {
    player.tapLeft = Math.max(0, player.tapLeft - dt);
    player.tapRight = Math.max(0, player.tapRight - dt);
    const left = held(player, "left") || player.tapLeft > 0;
    const right = held(player, "right") || player.tapRight > 0;
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    const wanted = dir * player.maxSpeed;
    if (dir) {
      player.vx = approach(player.vx, wanted, player.acceleration * dt);
      player.facing = dir;
    } else {
      player.vx = approach(player.vx, 0, player.friction * dt);
    }
    player.x += player.vx * dt;
    const bounds = player.side === 0 ? [70, NET_X - 34] : [NET_X + 34, WALL_R - 34];
    player.x = clamp(player.x, bounds[0], bounds[1]);
    player.moveBlend = lerp(player.moveBlend, Math.abs(player.vx) / player.maxSpeed, .18);
    // Holding the swing key keeps the racket ready through a rally. Each
    // contact still has a cooldown, so it cannot become an automatic hit.
    if (held(player, "swing") && player.swingTime <= 0 && player.swingCooldown <= 0) {
      beginSwing(player);
    }
  }

  function racketPose(player, overrideProgress = null) {
    const side = player.side === 0 ? 1 : -1;
    const baseX = player.x + side * 10;
    const baseY = FLOOR - player.y - 88;
    const active = player.swingTime > 0;
    const progress = overrideProgress ?? (active ? 1 - player.swingTime / player.swingDuration : 0);
    const eased = progress * progress * (3 - 2 * progress);
    const rest = side === 1 ? -.82 : Math.PI + .82;
    const start = side === 1 ? -1.58 : Math.PI + 1.58;
    const end = side === 1 ? .72 : Math.PI - .72;
    const angle = active ? lerp(start, end, eased) : rest;
    const reach = active ? 71 + Math.sin(progress * Math.PI) * 5 : 63;
    const handX = baseX + side * 7;
    const handY = baseY + 4;
    return {
      side,
      handX,
      handY,
      angle,
      tipX: handX + Math.cos(angle) * reach,
      tipY: handY + Math.sin(angle) * reach,
      progress,
      active
    };
  }

  function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy || 1;
    const t = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSq, 0, 1);
    const qx = x1 + t * dx;
    const qy = y1 + t * dy;
    return Math.hypot(px - qx, py - qy);
  }

  function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const cross = (x1, y1, x2, y2) => x1 * y2 - y1 * x2;
    const abx = bx - ax;
    const aby = by - ay;
    const cdx = dx - cx;
    const cdy = dy - cy;
    const denom = cross(abx, aby, cdx, cdy);
    if (Math.abs(denom) < 1e-6) return false;
    const acx = cx - ax;
    const acy = cy - ay;
    const t = cross(acx, acy, cdx, cdy) / denom;
    const u = cross(acx, acy, abx, aby) / denom;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  function distanceBetweenSegments(ax, ay, bx, by, cx, cy, dx, dy) {
    if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
    return Math.min(
      distanceToSegment(ax, ay, cx, cy, dx, dy),
      distanceToSegment(bx, by, cx, cy, dx, dy),
      distanceToSegment(cx, cy, ax, ay, bx, by),
      distanceToSegment(dx, dy, ax, ay, bx, by)
    );
  }

  function canReceive(player, shuttle) {
    const onOwnSide = player.side === 0
      ? shuttle.x < NET_X + 24
      : shuttle.x > NET_X - 24;
    const outgoingDirection = player.side === 0 ? 1 : -1;
    const incoming = shuttle.vx * outgoingDirection < 150;
    return onOwnSide && incoming && shuttle.lastHit !== player.side;
  }

  function hitBall(player) {
    const s = state.shuttle;
    if (!s || player.swingContacted || !canReceive(player, s)) return false;
    const progress = 1 - player.swingTime / player.swingDuration;
    if (progress < .14 || progress > .84) return false;

    const pose = racketPose(player, progress);
    const bx = s.x;
    const by = FLOOR - s.h;
    const previousBx = s.lastX;
    const previousBy = FLOOR - s.lastH;
    const racketDistance = distanceBetweenSegments(
      previousBx, previousBy, bx, by,
      pose.handX, pose.handY, pose.tipX, pose.tipY
    );
    const tipDistance = Math.min(
      Math.hypot(bx - pose.tipX, by - pose.tipY),
      Math.hypot(previousBx - pose.tipX, previousBy - pose.tipY)
    );
    const distance = Math.min(racketDistance, tipDistance);
    const contactRadius = player.human ? 62 : 56 + (player.side === 1 ? 8 : 0);
    const contactHeight = Math.max(s.h, s.lastH);
    if (distance > contactRadius || contactHeight < 26 || contactHeight > 430) return false;

    const timing = 1 - clamp(Math.abs(progress - .52) / .46, 0, 1);
    const sweet = 1 - clamp(distance / contactRadius, 0, 1);
    const contactHeightRatio = clamp((s.h - 78) / 250, 0, 1);
    const airborne = clamp(player.y / 150, 0, 1);
    const quality = clamp(.38 + timing * .34 + sweet * .24 + airborne * .08, .22, 1);
    const direction = player.side === 0 ? 1 : -1;
    const sideOffset = clamp((s.x - player.x) / 96, -1, 1);
    const baseSpeed = 760 + quality * 300 + Math.abs(player.vx) * .16;
    const aim = sideOffset * 100;
    const smash = contactHeightRatio > .56 && airborne > .16 && quality > .66;
    const launchHeight = smash
      ? 265 + quality * 90
      : 520 + (1 - contactHeightRatio) * 195 + (1 - quality) * 65;

    s.lastX = s.x;
    s.lastH = s.h;
    s.vx = direction * baseSpeed + direction * aim;
    s.vh = clamp(launchHeight, 240, 790);
    s.lastHit = player.side;
    s.age = 0;
    s.netHit = false;
    s.hitFlash = .18;
    s.rotation += direction * (.45 + quality);
    player.swingContacted = true;
    player.hitCooldown = .18;
    state.rally += 1;
    state.flash = smash ? .13 : .07;
    const label = smash ? "SMASH!" : quality > .72 ? "CLEAN HIT" : "HIT";
    setStatus(smash ? "SMASH" : "RALLY");
    showToast(label, .38);
    hitBurst(s.x, by, smash ? "#fff0a9" : "#ffd8bf", smash ? 22 : 11, smash);
    beep(smash ? "smash" : "hit");
    return true;
  }

  function updatePlayerPhysics(player, dt) {
    if (!player.onGround) {
      player.y += player.vy * dt;
      player.vy -= JUMP_GRAVITY * dt;
      if (player.y <= 0) {
        player.y = 0;
        player.vy = 0;
        player.onGround = true;
      }
    }
    player.swingCooldown = Math.max(0, player.swingCooldown - dt);
    player.hitCooldown = Math.max(0, player.hitCooldown - dt);
    player.scoreFlash = Math.max(0, player.scoreFlash - dt);
    if (player.swingTime > 0) {
      player.swingTime = Math.max(0, player.swingTime - dt);
      hitBall(player);
    }
  }

  function predictIntercept(side, targetHeight = 116) {
    const s = state.shuttle;
    if (!s) return null;
    const outgoingDirection = side === 0 ? 1 : -1;
    if (s.vx * outgoingDirection >= 110) return null;
    let x = s.x;
    let h = s.h;
    let vx = s.vx;
    let vh = s.vh;
    let previousX = x;
    for (let t = 0; t < 2.1; t += .025) {
      previousX = x;
      vx *= Math.exp(-SHUTTLE_DRAG * .025);
      vh = (vh - GRAVITY * .025) * Math.exp(-SHUTTLE_VERTICAL_DRAG * .025);
      x += vx * .025;
      h += vh * .025;
      if (x < WALL_L) { x = WALL_L; vx = Math.abs(vx) * .78; }
      if (x > WALL_R) { x = WALL_R; vx = -Math.abs(vx) * .78; }
      if ((previousX - NET_X) * (x - NET_X) < 0 && h < NET_HEIGHT + 6) return null;
      if (h <= targetHeight && vh < 0 && (side === 0 ? x < NET_X - 12 : x > NET_X + 12)) {
        return { x, h, t };
      }
      if (h < 0) return null;
    }
    return null;
  }

  function updateAI(player, dt) {
    const s = state.shuttle;
    const bounds = [NET_X + 34, WALL_R - 34];
    const incoming = canReceive(player, s);
    const intercept = incoming ? predictIntercept(player.side, 116) : null;
    let target = player.homeX || 755;
    if (intercept) {
      const error = (1 - state.aiSkill) * 36;
      target = clamp(intercept.x + Math.sin(state.clock * 2.2 + player.aiSeed) * error, bounds[0], bounds[1]);
    } else if (incoming && s.x > NET_X) {
      target = clamp(s.x + s.vx * .12, bounds[0], bounds[1]);
    }

    const distance = target - player.x;
    const desiredSpeed = clamp(distance * 5.4, -player.maxSpeed * (0.76 + state.aiSkill * .28), player.maxSpeed * (0.76 + state.aiSkill * .28));
    player.vx = approach(player.vx, desiredSpeed, player.acceleration * (0.76 + state.aiSkill * .35) * dt);
    player.x += player.vx * dt;
    player.x = clamp(player.x, bounds[0], bounds[1]);
    if (Math.abs(player.vx) > 15) player.facing = Math.sign(player.vx);
    player.moveBlend = lerp(player.moveBlend, Math.abs(player.vx) / player.maxSpeed, .18);

    if (intercept) {
      const needJump = intercept.h > player.y + 112 && intercept.t < .73;
      if (needJump && player.onGround && player.swingCooldown <= 0) jump(player);
      const timeToContact = intercept.t;
      if (timeToContact < .5 && Math.abs(intercept.x - player.x) < 116) beginSwing(player);
    }

    const currentDistance = Math.hypot(s.x - player.x, (FLOOR - s.h) - (FLOOR - player.y - 100));
    if (incoming && currentDistance < 116 && s.h < 330 && s.h > 45 && s.vh < 180) beginSwing(player);
  }

  function updateShuttle(dt) {
    const s = state.shuttle;
    if (!s || state.serveTimer > 0 || state.pointPause > 0) return;

    s.age += dt;
    s.lastX = s.x;
    s.lastH = s.h;
    s.trail.unshift({ x: s.x, y: FLOOR - s.h, life: 1, size: clamp(Math.hypot(s.vx, s.vh) / 440, 2, 6) });
    if (s.trail.length > 16) s.trail.pop();
    s.trail.forEach((p, index) => { p.life -= dt * (3.4 + index * .06); });
    s.trail = s.trail.filter((p) => p.life > 0);
    s.hitFlash = Math.max(0, s.hitFlash - dt);

    const previousX = s.x;
    const previousH = s.h;
    s.vx *= Math.exp(-SHUTTLE_DRAG * dt);
    s.vh = (s.vh - GRAVITY * dt) * Math.exp(-SHUTTLE_VERTICAL_DRAG * dt);
    s.x += s.vx * dt;
    s.h += s.vh * dt;
    s.rotation += s.vx * dt * .004;

    if (s.x < WALL_L) {
      s.x = WALL_L;
      s.vx = Math.abs(s.vx) * .78;
      wallBurst(s.x, FLOOR - s.h);
    }
    if (s.x > WALL_R) {
      s.x = WALL_R;
      s.vx = -Math.abs(s.vx) * .78;
      wallBurst(s.x, FLOOR - s.h);
    }

    if ((previousX - NET_X) * (s.x - NET_X) < 0) {
      const t = (NET_X - previousX) / (s.x - previousX || 1);
      const crossH = previousH + (s.h - previousH) * t;
      if (crossH <= NET_HEIGHT + 8) {
        s.x = NET_X + (s.x > previousX ? 5 : -5);
        s.h = Math.max(18, crossH);
        s.vx *= -.18;
        s.vh *= .28;
        s.netHit = true;
        showToast("NET", .32);
        hitBurst(NET_X, FLOOR - s.h, "#65b9cc", 8, false);
        beep("hit");
      }
    }

    if (s.h <= 0) scorePoint(s.x < NET_X ? 1 : 0);
  }

  function burst(x, y, color, count = 18) {
    for (let i = 0; i < count; i++) {
      state.particles.push({
        x, y,
        vx: rand(-180, 180),
        vy: rand(-380, -90),
        gravity: 520,
        life: rand(.35, .9),
        size: rand(2, 5),
        color
      });
    }
  }

  function hitBurst(x, y, color, count = 12, smash = false) {
    state.hitFx.push({ x, y, life: smash ? .48 : .32, max: smash ? .48 : .32, smash });
    burst(x, y, color, count);
  }

  function wallBurst(x, y) {
    state.hitFx.push({ x, y, life: .2, max: .2, wall: true });
  }

  function updateEffects(dt) {
    state.particles.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.life -= dt;
    });
    state.particles = state.particles.filter((p) => p.life > 0);
    state.hitFx.forEach((fx) => { fx.life -= dt; });
    state.hitFx = state.hitFx.filter((fx) => fx.life > 0);
  }

  function update(dt) {
    state.clock += dt;
    state.toastTimer = Math.max(0, state.toastTimer - dt);
    state.flash = Math.max(0, state.flash - dt);
    updateEffects(dt);
    if (state.screen !== "match") return;
    if (state.pointPause > 0 || state.serveTimer > 0) {
      startRallyIfReady(dt);
      return;
    }

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
    wall.addColorStop(0, "#727c7b");
    wall.addColorStop(.52, "#687371");
    wall.addColorStop(1, "#535c5b");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, 425);

    ctx.fillStyle = "rgba(18, 23, 23, .13)";
    ctx.fillRect(0, 0, 11, 425);
    ctx.fillRect(W - 11, 0, 11, 425);
    ctx.strokeStyle = "rgba(20, 26, 26, .27)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(45, 0); ctx.lineTo(45, 426);
    ctx.moveTo(915, 0); ctx.lineTo(915, 426);
    ctx.stroke();

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
    for (const ch of text) x += drawDigit(ch, x, 31, ch === "-" ? .9 : 1);
    ctx.restore();
  }

  function drawNet() {
    ctx.save();
    ctx.strokeStyle = "#2789aa";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(NET_X - 17, NET_TOP + 2); ctx.lineTo(NET_X - 17, FLOOR + 1);
    ctx.moveTo(NET_X + 17, NET_TOP + 2); ctx.lineTo(NET_X + 17, FLOOR + 1);
    ctx.stroke();
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
    const height = player.y;
    ctx.save();
    ctx.globalAlpha = .2 * (1 - clamp(height / 160, 0, .72));
    ctx.fillStyle = "#1c2826";
    ctx.beginPath();
    ctx.ellipse(player.x, FLOOR + 2, 23 + height * .06, 5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawRacket(player) {
    const pose = racketPose(player);
    const t = pose.active ? pose.progress : 0;
    ctx.save();
    if (pose.active) {
      const start = pose.side === 1 ? -1.58 : Math.PI + 1.58;
      const end = pose.side === 1 ? .72 : Math.PI - .72;
      ctx.globalAlpha = .22 * Math.sin(t * Math.PI);
      ctx.strokeStyle = player.info.accent;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(pose.handX, pose.handY, 57, start, end, pose.side < 0);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = "#b8c0bc";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pose.handX, pose.handY);
    ctx.lineTo(pose.tipX, pose.tipY);
    ctx.stroke();

    ctx.translate(pose.tipX, pose.tipY);
    ctx.rotate(pose.angle + Math.PI / 2);
    ctx.strokeStyle = "#e7e9df";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 0, 13, 28, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "rgba(207,218,211,.58)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-8, -17); ctx.lineTo(8, 17);
    ctx.moveTo(8, -17); ctx.lineTo(-8, 17);
    ctx.moveTo(0, -20); ctx.lineTo(0, 20);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(player) {
    const info = player.info;
    const bob = player.onGround ? Math.sin(state.clock * 8 + player.side * 1.3) * (1.2 + player.moveBlend * 1.8) : 0;
    const floorY = FLOOR - player.y;
    const bodyY = floorY + bob;
    const lean = clamp(player.vx / 800, -1, 1) * 4;
    const headX = player.x + lean;
    const headY = bodyY - 121;
    const shoulderY = bodyY - 90;
    const hipY = bodyY - 50;
    const side = player.side === 0 ? 1 : -1;
    const walk = Math.sin(state.clock * 13 + player.side) * player.moveBlend;
    const swing = player.swingTime > 0;

    drawShadow(player);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = info.body;
    ctx.fillStyle = info.body;
    ctx.lineWidth = 5;
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
      ctx.beginPath(); ctx.moveTo(armX, armY); ctx.lineTo(headX + side * 34, shoulderY - 28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(headX - side * 3, armY + 1); ctx.lineTo(headX - side * 28, shoulderY + 24); ctx.stroke();
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

    drawRacket(player);
    if (!player.onGround && player.y > 55) {
      ctx.globalAlpha = .32;
      ctx.strokeStyle = info.accent;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(player.x, floorY - 65, 29, Math.PI * .1, Math.PI * .9); ctx.stroke();
    }
    ctx.restore();
  }

  function drawShuttle() {
    const s = state.shuttle;
    if (!s) return;
    ctx.save();
    const shadowScale = clamp(1 - s.h / 420, .18, 1);
    ctx.globalAlpha = .24 * shadowScale;
    ctx.fillStyle = "#211b13";
    ctx.beginPath();
    ctx.ellipse(s.x, FLOOR + 3, 8 + shadowScale * 10, 2.5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    s.trail.forEach((p, i) => {
      if (p.life <= 0) return;
      ctx.globalAlpha = p.life * .23;
      ctx.fillStyle = i < 3 ? "#fff2dd" : "#f0af9e";
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.2, p.size * (1 - i / 19)), 0, TAU); ctx.fill();
    });
    ctx.globalAlpha = 1;

    const y = FLOOR - s.h;
    const speed = Math.hypot(s.vx, s.vh);
    const scale = 1 + clamp(speed / 1700, 0, .26);
    const angle = Math.atan2(-s.vh, s.vx || 1);
    ctx.save();
    ctx.translate(s.x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ee8584";
    ctx.strokeStyle = "#fff3de";
    ctx.lineWidth = 2;
    ctx.shadowColor = s.hitFlash > 0 ? "#fff1a9" : "transparent";
    ctx.shadowBlur = s.hitFlash > 0 ? 15 : 0;
    ctx.beginPath(); ctx.arc(0, 0, 6.3, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-2, -4.5); ctx.lineTo(-21, -12); ctx.lineTo(-20, 12); ctx.closePath();
    ctx.fillStyle = "#f6efe0"; ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#c7d0cb";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-7, -4); ctx.lineTo(-19, -8);
    ctx.moveTo(-7, 4); ctx.lineTo(-19, 8);
    ctx.moveTo(-8, 0); ctx.lineTo(-20, 0);
    ctx.stroke();
    ctx.restore();
  }

  function drawEffects() {
    state.particles.forEach((p) => {
      ctx.globalAlpha = clamp(p.life * 1.7, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    state.hitFx.forEach((fx) => {
      const t = 1 - fx.life / fx.max;
      ctx.save();
      ctx.globalAlpha = (1 - t) * .9;
      ctx.strokeStyle = fx.wall ? "#8dd3df" : fx.smash ? "#ffe58d" : "#fff0c4";
      ctx.lineWidth = fx.smash ? 3 : 2;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 12 + t * (fx.smash ? 38 : 22), 0, TAU);
      ctx.stroke();
      if (fx.smash) {
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * TAU + .2;
          ctx.beginPath();
          ctx.moveTo(fx.x + Math.cos(a) * 12, fx.y + Math.sin(a) * 12);
          ctx.lineTo(fx.x + Math.cos(a) * (24 + t * 30), fx.y + Math.sin(a) * (24 + t * 30));
          ctx.stroke();
        }
      }
      ctx.restore();
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
    drawEffects();
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

  function addKey(event) {
    keys.add(event.code);
    const key = (event.key || "").toLowerCase();
    if (key.length === 1) keys.add(key);
    const p1 = state.players[0];
    const p2 = state.players[1];
    if (event.code === "KeyA" || key === "a") p1.tapLeft = .16;
    if (event.code === "KeyD" || key === "d") p1.tapRight = .16;
    if (p2 && (event.code === "ArrowLeft" || key === "arrowleft")) p2.tapLeft = .16;
    if (p2 && (event.code === "ArrowRight" || key === "arrowright")) p2.tapRight = .16;
  }

  function removeKey(event) {
    keys.delete(event.code);
    if (event.key && event.key.length === 1) keys.delete(event.key.toLowerCase());
  }

  window.addEventListener("keydown", (event) => {
    const code = event.code;
    const key = (event.key || "").toLowerCase();
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(code)) event.preventDefault();
    if ((code === "KeyP" || key === "p") && !event.repeat) { togglePause(); return; }
    if ((code === "KeyM" || key === "m") && !event.repeat) {
      muted = !muted;
      $("connectionLight").innerHTML = "<i></i> " + (muted ? "MUTED" : "LOCAL PLAY");
      if (!muted) beep("swing");
      return;
    }
    if ((code === "Escape" || key === "escape") && !event.repeat) {
      if (state.screen === "match" || state.screen === "pause") exitToMenu();
      else menu();
      return;
    }
    addKey(event);
    if (event.repeat || state.screen !== "match" || state.serveTimer > 0 || state.pointPause > 0) return;
    if (code === "KeyW" || key === "w") jump(state.players[0]);
    if (code === "KeyS" || code === "Space" || key === "s") beginSwing(state.players[0]);
    if (state.mode === "local" && (code === "ArrowUp" || key === "arrowup")) jump(state.players[1]);
    if (state.mode === "local" && (code === "ArrowDown" || key === "arrowdown")) beginSwing(state.players[1]);
  });

  window.addEventListener("keyup", removeKey);
  window.addEventListener("blur", () => keys.clear());
  canvas.addEventListener("pointerdown", () => canvas.focus());

  document.querySelectorAll(".touch-controls button").forEach((button) => {
    const down = (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      const action = button.dataset.key;
      if (action === "jump") jump(state.players[0]);
      if (action === "swing") beginSwing(state.players[0]);
      if (action === "left") keys.add("KeyA");
      if (action === "right") keys.add("KeyD");
    };
    const up = (event) => {
      event.preventDefault();
      const action = button.dataset.key;
      if (action === "left") keys.delete("KeyA");
      if (action === "right") keys.delete("KeyD");
    };
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
    state.matchConfig = {
      mode: state.mode,
      player: $("playerSelect").value,
      opponent: $("opponentSelect").value
    };
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
    const dt = Math.min(.033, (time - state.lastTime) / 1000 || .016);
    state.lastTime = time;
    update(dt);
    drawScene();
    rafId = requestAnimationFrame(loop);
  }

  drawScene();
  rafId = requestAnimationFrame(loop);
  window.addEventListener("beforeunload", () => cancelAnimationFrame(rafId));
})();
