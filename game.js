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
  const SPRITE_SIZE = 226;
  const SPRITE_FEET_Y = 245;
  const SPRITE_SCALE = SPRITE_SIZE / 256;
  const SERVE_READY_TIME = .88;
  const SERVE_TOSS_TRIGGER = .50;
  const SERVE_CONTACT_TIME = .38;
  const SERVE_CONTACT_PROGRESS = .62;
  const SERVE_TOSS_ARC = 36;
  const SWING_POSE_TIMES = [0, .18, .48, .76, 1];
  const SWING_DRAW_TIMES = [.18, .48, .76, 1];

  const $ = (id) => document.getElementById(id);
  const keys = new Set();
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpAngle = (a, b, t) => {
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + delta * t;
  };
  const approachAngle = (current, target, maxStep) => {
    const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + clamp(delta, -maxStep, maxStep);
  };
  const smoothstep = (t) => t * t * (3 - 2 * t);
  const approach = (value, target, amount) => {
    if (value < target) return Math.min(value + amount, target);
    if (value > target) return Math.max(value - amount, target);
    return target;
  };

  const asset = (src) => {
    const image = new Image();
    image.decoding = "async";
    image.src = src;
    return image;
  };

  const art = {
    courtBackground: asset("assets/background/court-realistic.svg"),
    playerIdle: [1, 2, 3, 4].map((n) => asset(`assets/processed/player-idle/idle-${n}.png`)),
    playerCoral: [1, 2, 3, 4].map((n) => asset(`assets/processed/player-coral/idle-${n}.png`)),
    playerSky: [1, 2, 3, 4].map((n) => asset(`assets/processed/player-sky/idle-${n}.png`)),
    playerSwing: [1, 2, 3, 4].map((n) => asset(`assets/processed/player-swing/attack-${n}.png`)),
    opponentSwing: [1, 2, 3, 4].map((n) => asset(`assets/processed/opponent-swing/attack-${n}.svg`)),
    opponentIdle: [1, 2, 3, 4].map((n) => asset(`assets/processed/opponent-idle/idle-${n}.png`)),
    shuttle: [1, 2, 3, 4].map((n) => asset(`assets/processed/shuttle/projectile-${n}.png`))
  };
  // Each source frame has a different orientation. Anchoring the physics
  // point to the cork keeps the feathers behind the actual flight path.
  const shuttleFrameMeta = [
    { anchor: [.31, .70], corkAngle: 2.33 },
    { anchor: [.22, .58], corkAngle: 2.87 },
    { anchor: [.71, .69], corkAngle: .74 },
    { anchor: [.77, .48], corkAngle: -.09 }
  ];
  const drawableReady = (image) => Boolean(image && image.width > 0 && image.height > 0);

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
    const spriteKit = choice === "robot" ? "sky" : choice === "red" ? "coral" : "mint";
    return {
      side,
      x: side === 0 ? 205 : 755,
      homeX: side === 0 ? 205 : 755,
      y: 0,
      vy: 0,
      vx: 0,
      maxSpeed: 375,
      acceleration: 2700,
      friction: 3100,
      jumpSpeed: 720,
      onGround: true,
      swingTime: 0,
      swingDuration: .34,
      swingContacted: false,
      swingCooldown: 0,
      hitCooldown: 0,
      facing: side === 0 ? 1 : -1,
      human,
      choice,
      spriteKit,
      useOpponentIdle: side === 1 && choice === "red",
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
    const server = state.players[state.serveSide];
    const hand = server ? serveHandWorld(server) : null;
    const serveX = hand ? hand.x : (state.serveSide === 0 ? 250 : 710);
    const serveH = hand ? FLOOR - hand.y : 128;
    return {
      x: serveX,
      h: serveH,
      vx: 0,
      vh: 0,
      lastX: serveX,
      lastH: serveH,
      lastHit: -1,
      age: 0,
      trail: [],
      netHit: false,
      hitFlash: 0,
      rotation: 0,
      angle: Math.PI / 2,
      servePhase: "held",
      serveTossTime: 0,
      serveStartX: serveX,
      serveStartH: serveH,
      serveAngle: Math.PI / 2,
      displayFrame: 0
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

  function ensureAudio() {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") audioContext.resume();
    return audioContext;
  }

  function playTone(startFrequency, endFrequency, duration, volume, wave = "triangle", delay = 0) {
    const audio = ensureAudio();
    const now = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + Math.min(.008, duration * .18));
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + .01);
  }

  function playNoise(duration, lowFrequency, highFrequency, volume, delay = 0) {
    const audio = ensureAudio();
    const sampleRate = audio.sampleRate;
    const buffer = audio.createBuffer(1, Math.max(1, Math.floor(sampleRate * duration)), sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const envelope = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * envelope * envelope;
    }
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const now = audio.currentTime + delay;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(Math.sqrt(lowFrequency * highFrequency), now);
    filter.Q.setValueAtTime(1.15, now);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + Math.min(.006, duration * .15));
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start(now);
    source.stop(now + duration + .01);
  }

  function beep(type = "hit") {
    if (muted) return;
    try {
      if (type === "point") {
        playTone(392, 520, .14, .035, "sine");
        playTone(523, 784, .20, .028, "sine", .10);
      } else if (type === "swing") {
        playNoise(.095, 260, 1900, .018);
        playTone(190, 88, .095, .012, "sine");
      } else if (type === "serve") {
        playNoise(.050, 1050, 3600, .035);
        playTone(260, 132, .085, .025, "triangle");
      } else if (type === "smash") {
        playNoise(.075, 1500, 6200, .075);
        playTone(620, 122, .115, .045, "sawtooth");
      } else if (type === "net") {
        playNoise(.035, 900, 2500, .018);
        playTone(280, 210, .055, .012, "sine");
      } else {
        playNoise(.055, 1350, 4800, .046);
        playTone(320, 145, .070, .030, "triangle");
      }
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
    state.serveTimer = SERVE_READY_TIME;
    state.flash = 0;
    state.particles = [];
    state.hitFx = [];
    updateScoreHud();
    hideOverlays();
    setStatus("SERVE");
    showToast("READY", .72);
    canvas.focus();
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
    state.players.forEach((p, side) => {
      p.x = side === 0 ? 205 : 755;
      p.y = 0;
      p.vy = 0;
      p.vx = 0;
      p.swingTime = 0;
      p.swingContacted = false;
      p.swingCooldown = 0;
      p.hitCooldown = 0;
      p.onGround = true;
    });
    // Recreate the held shuttle only after both players have returned to their
    // serve positions, so its first frame is anchored to the real hand.
    state.shuttle = createShuttle();
    state.serveTimer = SERVE_READY_TIME;
    state.pointPause = 0;
    state.flash = .15;
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
    state.shuttle.servePhase = "point";
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
      updateServeAnimation(dt);
      state.serveTimer -= dt;
      if (state.serveTimer <= 0 && state.shuttle?.servePhase !== "flight") serve();
      return true;
    }
    return false;
  }

  function serve() {
    const server = state.players[state.serveSide];
    const direction = server.side === 0 ? 1 : -1;
    const s = state.shuttle;
    const contact = racketPose(server, SERVE_CONTACT_PROGRESS);
    const contactHeight = clamp(FLOOR - contact.tipY, 28, 430);
    s.x = contact.tipX;
    s.h = contactHeight;
    s.vx = direction * 690;
    s.vh = 650;
    s.lastX = s.x;
    s.lastH = s.h;
    s.lastHit = server.side;
    s.age = 0;
    s.trail = [];
    s.netHit = false;
    s.servePhase = "flight";
    s.serveTossTime = 0;
    s.displayFrame = 0;
    s.serveAngle = Math.atan2(-s.vh, s.vx || direction);
    s.angle = s.serveAngle;
    s.rotation = 0;
    state.serveTimer = 0;
    // Keep the visible follow-through after the exact contact frame instead
    // of restarting the racket from frame zero when the serve becomes flight.
    server.swingTime = server.swingDuration * (1 - SERVE_CONTACT_PROGRESS);
    server.swingCooldown = Math.max(server.swingCooldown, .23);
    server.swingContacted = true;
    setStatus("RALLY");
    showToast("PLAY", .45);
    beep("serve");
  }

  function spritePointToWorld(player, point, active = false) {
    const flip = spriteShouldBeFlipped(player, active);
    const lean = clamp(player.vx / 800, -1, 1) * 4;
    const drawY = FLOOR - player.y - SPRITE_SIZE * (SPRITE_FEET_Y / 256);
    return {
      x: player.x + lean + (flip ? 256 - point[0] : point[0]) * SPRITE_SCALE - 128 * SPRITE_SCALE,
      y: drawY + point[1] * SPRITE_SCALE
    };
  }

  function serveHandWorld(player) {
    if (!useSpriteArt(player)) {
      // The hand-drawn figure has a different proportion from the old image
      // sheets. Keep the shuttle on the actual free hand instead of reusing
      // the sprite-sheet measurement, which would place it near the face.
      const figure = vectorFigureTransform(player);
      const side = figure.side;
      return {
        x: figure.headX - side * (figure.active ? 31 : 47),
        y: figure.shoulderY + (figure.active ? 58 : 49)
      };
    }
    // The non-racket hand is the launch point. The opponent idle art already
    // faces left, so its free hand uses the right side of the source frame.
    const hand = player.useOpponentIdle ? [164, 134] : [101, 134];
    return spritePointToWorld(player, hand, false);
  }

  function beginServeSwing(player) {
    if (!player || player.swingTime > 0) return;
    player.swingTime = player.swingDuration;
    player.swingCooldown = .23;
    player.swingContacted = true;
    beep("swing");
  }

  function updateServeAnimation(dt) {
    const s = state.shuttle;
    const server = state.players[state.serveSide];
    if (!s || !server || s.servePhase === "flight") return;

    if (s.servePhase === "held" && state.serveTimer <= SERVE_TOSS_TRIGGER) {
      s.servePhase = "toss";
      s.serveTossTime = 0;
      const hand = serveHandWorld(server);
      s.serveStartX = hand.x;
      s.serveStartH = FLOOR - hand.y;
      s.rotation = 0;
    }

    const hand = serveHandWorld(server);
    const direction = server.side === 0 ? 1 : -1;
    if (s.servePhase === "held") {
      s.x = hand.x;
      s.h = FLOOR - hand.y;
      s.lastX = s.x;
      s.lastH = s.h;
      s.displayFrame = 0;
      s.rotation = 0;
      return;
    }

    s.serveTossTime += dt;
    const t = clamp(s.serveTossTime / SERVE_CONTACT_TIME, 0, 1);
    const swingStart = SERVE_CONTACT_TIME - server.swingDuration * SERVE_CONTACT_PROGRESS;
    if (s.serveTossTime >= swingStart && server.swingTime <= 0) beginServeSwing(server);
    // The normal match update is intentionally paused during a serve, so the
    // serve animation must advance its own swing clock here.
    if (server.swingTime > 0) server.swingTime = Math.max(0, server.swingTime - dt);

    // A short, visible underhand toss: rise first, then drop into the
    // forward swing instead of teleporting from the player's hand.
    const contact = racketPose(server, SERVE_CONTACT_PROGRESS);
    const contactHeight = clamp(FLOOR - contact.tipY, 28, 430);
    const startX = Number.isFinite(s.serveStartX) ? s.serveStartX : hand.x;
    const startH = Number.isFinite(s.serveStartH) ? s.serveStartH : FLOOR - hand.y;
    const tossT = clamp(t / .72, 0, 1);
    const dropT = clamp((t - .72) / .28, 0, 1);
    const peakHeight = Math.max(188, Math.max(startH, contactHeight) + 72);
    const tossHeight = t < .72
      ? lerp(startH, peakHeight, 1 - Math.pow(1 - tossT, 2))
      : lerp(peakHeight, contactHeight, dropT * dropT);
    // Carry the toss toward the racket side in a shallow arc. A straight
    // line through the torso makes the shuttle appear to pass through the
    // player's face while the hand-off is still in progress.
    const tossCurve = SERVE_TOSS_ARC * Math.sin(Math.PI * Math.pow(t, .78));
    s.x = lerp(startX, contact.tipX, t)
      + direction * tossCurve;
    s.h = tossHeight;
    s.lastX = s.x;
    s.lastH = s.h;
    s.displayFrame = 0;
    const flightAngle = Math.atan2(-650, direction * 690);
    s.serveAngle = lerpAngle(Math.PI / 2, flightAngle, smoothstep(dropT));
    s.angle = s.serveAngle;

    if (s.serveTossTime >= SERVE_CONTACT_TIME) serve();
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

  const playerSwingRacketFrames = [
    { hand: [98, 129], head: [158, 78] },
    { hand: [143, 121], head: [221, 87] },
    { hand: [144, 112], head: [183, 64] },
    { hand: [145, 92], head: [183, 66] }
  ];
  // These points are measured from the generated red-player attack frames.
  // The collision segment is the same hand-to-racket line shown on screen.
  const opponentSwingRacketFrames = [
    { hand: [78, 104], head: [79, 55] },
    { hand: [130, 84], head: [111, 43] },
    { hand: [89, 62], head: [29, 56] },
    { hand: [139, 58], head: [168, 43] }
  ];
  const idleRacketRight = { hand: [138, 144], head: [175, 120] };
  const idleRacketLeft = { hand: [116, 141], head: [80, 108] };

  function spriteShouldBeFlipped(player, active) {
    if (player.side === 0) return false;
    // The red opponent's idle and attack assets both already face left.
    // Other kits reuse the right-facing player art and are mirrored here.
    return !player.useOpponentIdle;
  }

  function spriteRacketPose(player, overrideProgress = null) {
    const active = player.swingTime > 0 || overrideProgress !== null;
    const progress = overrideProgress ?? (active ? 1 - player.swingTime / player.swingDuration : 0);
    let frame;
    if (active) {
      const swingFrames = player.useOpponentIdle ? opponentSwingRacketFrames : playerSwingRacketFrames;
      const frameT = clamp(progress, 0, 1) * (swingFrames.length - 1);
      const from = Math.floor(frameT);
      const to = Math.min(swingFrames.length - 1, from + 1);
      const mix = frameT - from;
      const blend = (a, b) => [lerp(a[0], b[0], mix), lerp(a[1], b[1], mix)];
      frame = {
        hand: blend(swingFrames[from].hand, swingFrames[to].hand),
        head: blend(swingFrames[from].head, swingFrames[to].head)
      };
    } else {
      frame = player.useOpponentIdle ? idleRacketLeft : idleRacketRight;
    }
    const flip = spriteShouldBeFlipped(player, active);
    const lean = clamp(player.vx / 800, -1, 1) * 4;
    const drawY = FLOOR - player.y - SPRITE_SIZE * (SPRITE_FEET_Y / 256);
    const toWorld = ([x, y]) => ({
      x: player.x + lean + (flip ? 256 - x : x) * SPRITE_SCALE - 128 * SPRITE_SCALE,
      y: drawY + y * SPRITE_SCALE
    });
    const hand = toWorld(frame.hand);
    const head = toWorld(frame.head);
    return {
      side: player.side === 0 ? 1 : -1,
      handX: hand.x,
      handY: hand.y,
      angle: Math.atan2(head.y - hand.y, head.x - hand.x),
      tipX: head.x,
      tipY: head.y,
      progress,
      active,
      sprite: true
    };
  }

  function vectorFigureTransform(player, overrideProgress = null) {
    const side = player.side === 0 ? 1 : -1;
    const lean = clamp(player.vx / 800, -1, 1) * 4;
    const active = player.swingTime > 0 || overrideProgress !== null;
    const progress = overrideProgress ?? (active ? 1 - player.swingTime / player.swingDuration : 0);
    const bob = player.onGround
      ? Math.sin(state.clock * 8 + player.side * 1.3) * (1.1 + player.moveBlend * 1.7)
      : 0;
    const actionShift = active ? side * Math.sin(progress * Math.PI) * 7 : 0;
    const bodyY = FLOOR - player.y + bob;
    const headX = player.x + lean + actionShift;
    const headY = bodyY - 151;
    const shoulderY = bodyY - 113;
    const hipY = bodyY - 55;
    return { side, lean, active, progress, bob, actionShift, bodyY, headX, headY, shoulderY, hipY };
  }

  function vectorRacketPose(player, overrideProgress = null) {
    const figure = vectorFigureTransform(player, overrideProgress);
    const { side, active, progress } = figure;
    // The hand sits at the end of the striking arm. Keeping this single pose
    // as the source for both drawing and collision prevents the racket from
    // visually floating away from the stick figure.
    const baseX = figure.headX + side * 30;
    const baseY = figure.bodyY - 112;
    const eased = progress < .5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    const rest = side === 1 ? -.88 : Math.PI + .88;
    const start = side === 1 ? -1.66 : Math.PI + 1.66;
    const end = side === 1 ? .46 : Math.PI - .46;
    const angle = active ? lerp(start, end, eased) : rest;
    const reach = active ? 70 + Math.sin(progress * Math.PI) * 9 : 60;
    const handX = baseX;
    const handY = baseY;
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

  function useSpriteArt(player) {
    // The generated character sheets looked detailed, but their timing did
    // not read as a single playable action. Keep the readable hand-drawn
    // figures for every kit; the racket pose and collision share one source.
    return false;
  }

  function racketPose(player, overrideProgress = null) {
    return useSpriteArt(player)
      ? spriteRacketPose(player, overrideProgress)
      : vectorRacketPose(player, overrideProgress);
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
      ? shuttle.x < NET_X + 24 || shuttle.lastX < NET_X + 24
      : shuttle.x > NET_X - 24 || shuttle.lastX > NET_X - 24;
    const outgoingDirection = player.side === 0 ? 1 : -1;
    const incoming = shuttle.vx * outgoingDirection < 150;
    return onOwnSide && incoming && shuttle.lastHit !== player.side;
  }

  function hitBall(player) {
    const s = state.shuttle;
    if (!s || player.swingContacted || !canReceive(player, s)) return false;
    const progress = 1 - player.swingTime / player.swingDuration;
    // Contact is restricted to the racket's forward stroke. The late
    // follow-through is still rendered, but it can no longer create a hit
    // after the visible racket has already passed the shuttle.
    const latestContactFrame = player.human ? .84 : .76;
    if (progress < .24 || progress > latestContactFrame) return false;

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
    const contactRadius = player.human ? 38 : 34;
    const contactHeight = Math.max(s.h, s.lastH);
    if (distance > contactRadius || contactHeight < 26 || contactHeight > 430) return false;

    const timing = 1 - clamp(Math.abs(progress - .52) / .46, 0, 1);
    const sweet = 1 - clamp(distance / contactRadius, 0, 1);
    const contactHeightRatio = clamp((s.h - 78) / 250, 0, 1);
    const airborne = clamp(player.y / 150, 0, 1);
    const quality = clamp(.38 + timing * .34 + sweet * .24 + airborne * .08, .22, 1);
    const direction = player.side === 0 ? 1 : -1;
    const sideOffset = clamp((s.x - player.x) / 96, -1, 1);
    const aim = sideOffset * 105;
    // A smash is a fast, shallow shot. Aim its apex at the top of the net so
    // the shuttle crosses with clearance, then falls into the receiver's
    // forecourt instead of turning into another high lob.
    const smash = contactHeightRatio > .72 && airborne > .10 && quality > .66;
    const baseSpeed = smash
      ? 1080 + quality * 300 + Math.abs(player.vx) * .12
      : 760 + quality * 300 + Math.abs(player.vx) * .16;
    const launchHeight = smash
      ? 24 + quality * 72
      : 520 + (1 - contactHeightRatio) * 195 + (1 - quality) * 65;
    const timeToNet = Math.max(.13, Math.abs(NET_X - player.x) / baseSpeed);
    const smashVertical = (NET_HEIGHT + 54 - s.h + .5 * GRAVITY * timeToNet * timeToNet) / timeToNet;

    s.lastX = s.x;
    s.lastH = s.h;
    s.vx = direction * baseSpeed + direction * aim;
    s.vh = smash ? clamp(smashVertical, -520, 160) : clamp(launchHeight, 240, 790);
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
    hitBurst(s.x, by, smash ? "#fff0a9" : "#ffd8bf", smash ? 22 : 11, smash, Math.atan2(-s.vh, s.vx));
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
    const hitDirection = player.side === 0 ? 1 : -1;
    // The racket head sits in front of the player's body. Move the body
    // behind the predicted contact point so the sweet spot, rather than the
    // player's centre, meets the shuttle.
    const racketLead = 64;
    const incoming = canReceive(player, s);
    // The red player's real racket head sits around 170–180 world units when
    // grounded. Predict that height instead of waiting for the shuttle to
    // drop to the ankles, which made the old AI swing too early and miss.
    const intercept = incoming ? predictIntercept(player.side, 176) : null;
    let target = player.homeX || 755;
    if (intercept) {
      const error = (1 - state.aiSkill) * 36;
      target = clamp(intercept.x - hitDirection * racketLead + Math.sin(state.clock * 2.2 + player.aiSeed) * error, bounds[0], bounds[1]);
    } else if (incoming && s.x > NET_X) {
      target = clamp(s.x - hitDirection * racketLead + s.vx * .12, bounds[0], bounds[1]);
    }

    const distance = target - player.x;
    const desiredSpeed = clamp(distance * 5.4, -player.maxSpeed * (0.76 + state.aiSkill * .28), player.maxSpeed * (0.76 + state.aiSkill * .28));
    player.vx = approach(player.vx, desiredSpeed, player.acceleration * (0.76 + state.aiSkill * .35) * dt);
    player.x += player.vx * dt;
    player.x = clamp(player.x, bounds[0], bounds[1]);
    if (Math.abs(player.vx) > 15) player.facing = Math.sign(player.vx);
    player.moveBlend = lerp(player.moveBlend, Math.abs(player.vx) / player.maxSpeed, .18);

    if (intercept) {
      const needJump = intercept.h > player.y + 214 && intercept.t < .8;
      if (needJump && player.onGround && player.swingCooldown <= 0) jump(player);
      const timeToContact = intercept.t;
      if (timeToContact < .19 && Math.abs(intercept.x - (player.x + hitDirection * racketLead)) < 118) beginSwing(player);
    }

    const currentDistance = Math.hypot(s.x - (player.x + hitDirection * racketLead), (FLOOR - s.h) - (FLOOR - player.y - 100));
    if (!intercept && incoming && currentDistance < 112 && s.h < 215 && s.h > 105 && s.vh < 160) beginSwing(player);
  }

  function updateShuttle(dt) {
    const s = state.shuttle;
    if (!s || state.serveTimer > 0 || state.pointPause > 0) return;

    s.age += dt;
    s.lastX = s.x;
    s.lastH = s.h;
    s.trail.unshift({
      x: s.x,
      y: FLOOR - s.h,
      life: 1,
      size: clamp(Math.hypot(s.vx, s.vh) / 440, 2, 6),
      speed: Math.hypot(s.vx, s.vh),
      angle: s.angle
    });
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
    s.angle = approachAngle(s.angle, Math.atan2(-s.vh, s.vx || 1), dt * 14);
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
        beep("net");
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

  function hitBurst(x, y, color, count = 12, smash = false, angle = 0) {
    state.hitFx.push({ x, y, life: smash ? .48 : .32, max: smash ? .48 : .32, smash, angle });
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
    if (drawableReady(art.courtBackground)) {
      ctx.drawImage(art.courtBackground, 0, 0, W, H);
      return;
    }

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

  function drawRacket(player, pose = racketPose(player)) {
    const t = pose.active ? pose.progress : 0;
    const drawFrame = (frame, alpha = 1, ghost = false) => {
      const centerX = frame.tipX + Math.cos(frame.angle) * 7;
      const centerY = frame.tipY + Math.sin(frame.angle) * 7;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ghost ? player.info.accent : "#e7e9df";
      ctx.lineWidth = ghost ? 2.5 : 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(frame.handX, frame.handY);
      ctx.lineTo(frame.tipX, frame.tipY);
      ctx.stroke();
      ctx.translate(centerX, centerY);
      ctx.rotate(frame.angle);
      ctx.beginPath(); ctx.ellipse(0, 0, 12, 25, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = ghost ? player.info.accent : "rgba(207,218,211,.66)";
      ctx.lineWidth = ghost ? 1 : 1.1;
      ctx.beginPath();
      ctx.moveTo(-7, -16); ctx.lineTo(7, 16);
      ctx.moveTo(7, -16); ctx.lineTo(-7, 16);
      ctx.moveTo(0, -20); ctx.lineTo(0, 20);
      ctx.moveTo(-10, -7); ctx.lineTo(10, -7);
      ctx.moveTo(-10, 7); ctx.lineTo(10, 7);
      ctx.stroke();
      ctx.restore();
    };

    if (pose.active) {
      const start = pose.side === 1 ? -1.66 : Math.PI + 1.66;
      const end = pose.side === 1 ? .46 : Math.PI - .46;
      ctx.save();
      ctx.globalAlpha = .12 + Math.sin(t * Math.PI) * .12;
      ctx.strokeStyle = player.info.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pose.handX, pose.handY, 67, start, end, pose.side < 0);
      ctx.stroke();
      ctx.globalAlpha = .42 * Math.sin(t * Math.PI);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pose.handX, pose.handY, 75, start, lerp(start, end, Math.max(0, t - .08)), pose.side < 0);
      ctx.stroke();
      ctx.restore();
      if (t > .08) drawFrame(racketPose(player, clamp(t - .16, 0, 1)), .12, true);
      if (t > .18) drawFrame(racketPose(player, clamp(t - .08, 0, 1)), .2, true);
    }
    drawFrame(pose);
  }

  function drawStickPlayer(player) {
    const info = player.info;
    const floorY = FLOOR - player.y;
    const figure = vectorFigureTransform(player);
    const { side, active, progress, headX, bodyY, headY, shoulderY, hipY } = figure;
    const kit = player.choice === "red" ? "#e95a58" : player.choice === "robot" ? "#49b6c9" : "#42a99b";
    const kitLight = player.choice === "red" ? "#ff8b72" : player.choice === "robot" ? "#8ce4e5" : "#9de1c0";
    const skin = player.choice === "robot" ? "#9bdce3" : "#d9956b";
    const pants = "#20353c";
    const pose = racketPose(player);

    drawShadow(player);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Legs are deliberately chunky so footwork remains readable at game
    // speed. The small walk phase gives idle movement without wobbling the
    // collision points.
    const walk = Math.sin(state.clock * 11 + player.side) * player.moveBlend;
    ctx.strokeStyle = pants;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(headX - 11, hipY); ctx.lineTo(headX - 18 + walk * 5, bodyY + 2);
    ctx.moveTo(headX + 11, hipY); ctx.lineTo(headX + 18 - walk * 5, bodyY + 2);
    ctx.stroke();

    // Shoes have a soft highlight so the feet remain visible against the
    // court. They also sell the quick side-to-side movement better than a
    // pair of one-pixel stick ends.
    ctx.fillStyle = player.choice === "red" ? "#ff8b72" : player.choice === "robot" ? "#d1f1ef" : "#f08a73";
    ctx.strokeStyle = info.body;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(headX - 20 + walk * 5, bodyY + 3, 22, 8, -.08, 0, TAU);
    ctx.ellipse(headX + 20 - walk * 5, bodyY + 3, 22, 8, .08, 0, TAU);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.48)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(headX - 32 + walk * 5, bodyY + 1); ctx.lineTo(headX - 17 + walk * 5, bodyY + 1);
    ctx.moveTo(headX + 8 - walk * 5, bodyY + 1); ctx.lineTo(headX + 24 - walk * 5, bodyY + 1);
    ctx.stroke();

    // Shirt and a small number badge make the three kits readable without
    // importing another sprite sheet.
    ctx.fillStyle = kit;
    ctx.strokeStyle = info.body;
    ctx.lineWidth = 4;
    roundRect(headX - 26, shoulderY + 3, 52, 66, 15);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.18)";
    ctx.beginPath(); ctx.ellipse(headX + side * 9, shoulderY + 36, 7, 24, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = kitLight;
    ctx.font = "800 15px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(player.choice === "robot" ? "AI" : player.choice === "red" ? "M" : "01", headX, shoulderY + 42);

    // Draw arms over the shirt but under the head and racket. The racket arm
    // follows the exact pose used by collision; this prevents visual drift.
    const freeShoulderX = headX - side * 19;
    const freeShoulderY = shoulderY + 15;
    const freeElbowX = headX - side * (active ? 43 : 35);
    const freeElbowY = shoulderY + (active ? 42 : 34);
    const freeHandX = headX - side * (active ? 31 : 47);
    const freeHandY = shoulderY + (active ? 58 : 49);
    ctx.strokeStyle = info.body;
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(freeShoulderX, freeShoulderY); ctx.lineTo(freeElbowX, freeElbowY); ctx.lineTo(freeHandX, freeHandY); ctx.stroke();
    ctx.strokeStyle = skin;
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(freeShoulderX, freeShoulderY); ctx.lineTo(freeElbowX, freeElbowY); ctx.lineTo(freeHandX, freeHandY); ctx.stroke();

    const racketShoulderX = headX + side * 19;
    const racketShoulderY = shoulderY + 14;
    ctx.strokeStyle = info.body;
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(racketShoulderX, racketShoulderY); ctx.lineTo(pose.handX, pose.handY); ctx.stroke();
    ctx.strokeStyle = skin;
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(racketShoulderX, racketShoulderY); ctx.lineTo(pose.handX, pose.handY); ctx.stroke();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(pose.handX, pose.handY, 5, 0, TAU); ctx.fill();

    // Neck and head.
    ctx.strokeStyle = skin;
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(headX, shoulderY + 10); ctx.lineTo(headX, headY + 19); ctx.stroke();
    ctx.fillStyle = skin;
    ctx.strokeStyle = info.body;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(headX, headY, 20, 0, TAU); ctx.fill(); ctx.stroke();

    if (player.choice === "robot") {
      ctx.fillStyle = "#143844";
      roundRect(headX - 18, headY - 13, 36, 21, 5); ctx.fill();
      ctx.strokeStyle = "#8ee7ef"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(headX - 11, headY - 3); ctx.lineTo(headX + 11, headY - 3); ctx.stroke();
      ctx.fillStyle = "#c8ffff";
      ctx.beginPath(); ctx.arc(headX + side * 7, headY - 3, 2.4, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = player.choice === "red" ? "#2c2024" : "#18272b";
      ctx.beginPath(); ctx.arc(headX - side * 2, headY - 6, 20, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
      ctx.beginPath(); ctx.arc(headX - side * 14, headY - 3, 7, 0, TAU); ctx.fill();
      if (player.choice === "sam") {
        ctx.fillStyle = "#101618";
        ctx.fillRect(headX - 22, headY - 24, 44, 5);
        ctx.fillRect(headX - 13, headY - 42, 26, 18);
        ctx.fillRect(headX - 17, headY - 45, 34, 4);
      }
      ctx.fillStyle = "#141c20";
      ctx.beginPath(); ctx.arc(headX + side * 7, headY - 1, 2.4, 0, TAU); ctx.fill();
    }

    drawRacket(player, pose);
    if (!player.onGround && player.y > 55) {
      ctx.globalAlpha = .28;
      ctx.strokeStyle = info.accent;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(player.x, floorY - 65, 29, Math.PI * .1, Math.PI * .9); ctx.stroke();
    }
    ctx.restore();
  }

  function getSwingFrame(player, index) {
    // The swing frames contain the actual racket, arm extension and follow
    // through. Keep them as source images so the same frame is used by both
    // rendering and collision; recolouring a cross-origin image would taint
    // the canvas and make the whole animation disappear.
    return (player.useOpponentIdle ? art.opponentSwing : art.playerSwing)[index];
  }

  function idleFramesFor(player) {
    if (player.useOpponentIdle) return art.opponentIdle;
    if (player.spriteKit === "coral") return art.playerCoral;
    if (player.spriteKit === "sky") return art.playerSky;
    return art.playerIdle;
  }

  function drawSpritePlayer(player) {
    const active = player.swingTime > 0;
    const progress = active ? 1 - player.swingTime / player.swingDuration : 0;
    const frameIndex = active
      ? clamp(Math.floor(progress * art.playerSwing.length), 0, art.playerSwing.length - 1)
      : Math.floor(state.clock * 3.2 + player.side * .7) % 4;
    const image = active ? getSwingFrame(player, frameIndex) : idleFramesFor(player)[frameIndex];
    if (!drawableReady(image)) {
      drawStickPlayer(player);
      return;
    }

    const lean = clamp(player.vx / 800, -1, 1) * 4;
    const drawY = FLOOR - player.y - SPRITE_SIZE * (SPRITE_FEET_Y / 256);
    const flip = spriteShouldBeFlipped(player, active);
    drawShadow(player);

    ctx.save();
    ctx.translate(player.x + lean, 0);
    ctx.scale(flip ? -1 : 1, 1);
    ctx.globalAlpha = .98;
    ctx.drawImage(image, -SPRITE_SIZE / 2, drawY, SPRITE_SIZE, SPRITE_SIZE);
    ctx.restore();

    if (active) {
      const pose = racketPose(player);
      ctx.save();
      ctx.globalAlpha = .16 + Math.sin(progress * Math.PI) * .16;
      ctx.strokeStyle = player.info.accent;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(pose.handX, pose.handY);
      ctx.lineTo(pose.tipX, pose.tipY);
      ctx.stroke();
      ctx.restore();
    }

    if (!player.onGround && player.y > 55) {
      ctx.save();
      ctx.globalAlpha = .18;
      ctx.strokeStyle = player.info.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, FLOOR - player.y - 72, 31, Math.PI * .1, Math.PI * .9);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPlayer(player) {
    if (useSpriteArt(player)) drawSpritePlayer(player);
    else drawStickPlayer(player);
  }

  function drawShuttle() {
    const s = state.shuttle;
    if (!s) return;
    const inFlight = s.servePhase === "flight";
    const y = FLOOR - s.h;
    const speed = Math.hypot(s.vx, s.vh);
    const angle = inFlight ? (s.angle ?? Math.atan2(-s.vh, s.vx || 1)) : s.serveAngle;
    const scale = inFlight ? clamp(.9 + speed / 1100, .95, 1.38) : .88;

    if (inFlight) {
      ctx.save();
      const shadowScale = clamp(1 - s.h / 420, .18, 1);
      ctx.globalAlpha = .24 * shadowScale;
      ctx.fillStyle = "#211b13";
      ctx.beginPath();
      ctx.ellipse(s.x, FLOOR + 3, 8 + shadowScale * 10, 2.5, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // The trail follows the actual velocity vector. Each segment fades from
    // the cork position backward, so a fast clear reads as motion instead of
    // a decorative line glued to the shuttle.
    if (inFlight && s.trail.length) {
      const trailLength = clamp(speed * .020, 10, 30);
      s.trail.forEach((p, i) => {
        if (p.life <= 0) return;
        const fade = p.life * (.32 - Math.min(i, 12) * .018);
        const length = trailLength * (1 + i * .06);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle ?? angle);
        ctx.globalAlpha = Math.max(.025, fade);
        ctx.strokeStyle = i < 3 ? "#fff7df" : "#e8a49a";
        ctx.lineWidth = Math.max(1, 4 - i * .18);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(-length * (p.speed ? clamp(p.speed / Math.max(speed, 1), .72, 1.2) : 1), 0);
        ctx.quadraticCurveTo(-length * .45, i % 2 ? 2.5 : -2.5, 0, 0);
        ctx.stroke();
        ctx.restore();
      });
    }

    // The impact halo is drawn around the cork, not around the whole shuttle,
    // so the effect lands exactly where the racket meets it.
    ctx.save();
    ctx.translate(s.x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    if (s.hitFlash > 0) {
      ctx.globalAlpha = clamp(s.hitFlash * 5, 0, 1);
      ctx.strokeStyle = "#fff0af";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, 12 + (1 - s.hitFlash / .18) * 10, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // During a serve toss the cork stays locked to one hand-made frame; only
    // its position changes. In flight the feather fan gets a subtle spin,
    // while the cork remains the leading point.
    const fanTilt = inFlight ? Math.sin(s.rotation * .9) * .11 : 0;
    ctx.save();
    ctx.rotate(fanTilt);
    const featherGradient = ctx.createLinearGradient(-36, 0, 4, 0);
    featherGradient.addColorStop(0, "#f7f6e9");
    featherGradient.addColorStop(.6, "#fffdf2");
    featherGradient.addColorStop(1, "#d9d8c4");
    ctx.fillStyle = featherGradient;
    ctx.strokeStyle = "rgba(173,176,158,.95)";
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.moveTo(4, -3.5);
    ctx.bezierCurveTo(-8, -7, -22, -17, -35, -15);
    ctx.quadraticCurveTo(-29, -4, -33, 0);
    ctx.quadraticCurveTo(-29, 7, -35, 15);
    ctx.bezierCurveTo(-22, 17, -8, 7, 4, 3.5);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Individual vanes keep the shuttle legible when it is small on screen.
    ctx.strokeStyle = "rgba(176,178,160,.92)";
    ctx.lineWidth = 1;
    for (let i = -4; i <= 4; i++) {
      const spread = i * 2.55;
      ctx.beginPath();
      ctx.moveTo(2, spread * .38);
      ctx.quadraticCurveTo(-15, spread * 1.03, -31, spread * 1.16);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,.78)";
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(1, -1); ctx.lineTo(-28, -10); ctx.moveTo(1, 1); ctx.lineTo(-28, 10); ctx.stroke();
    ctx.restore();

    // Cork: warm leather colour, pale highlight, and one dark seam. The
    // physics point is its centre, so the racket never hits the feathers.
    const corkGradient = ctx.createRadialGradient(-2, -3, 1, 1, 1, 8);
    corkGradient.addColorStop(0, "#fff5d3");
    corkGradient.addColorStop(.55, "#e8c995");
    corkGradient.addColorStop(1, "#9d694b");
    ctx.fillStyle = corkGradient;
    ctx.strokeStyle = "#704a3b";
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "rgba(255,247,218,.8)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(-2, -2, 2.1, 0, TAU); ctx.stroke();
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
      if (fx.angle !== undefined) {
        ctx.strokeStyle = fx.smash ? "#fff1a9" : "rgba(255,240,196,.78)";
        ctx.lineWidth = fx.smash ? 2.6 : 1.5;
        for (let i = -1; i <= 1; i++) {
          const a = fx.angle + i * .24;
          ctx.beginPath();
          ctx.moveTo(fx.x + Math.cos(a) * 10, fx.y + Math.sin(a) * 10);
          ctx.lineTo(fx.x + Math.cos(a) * (30 + t * (fx.smash ? 48 : 25)), fx.y + Math.sin(a) * (30 + t * (fx.smash ? 48 : 25)));
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
