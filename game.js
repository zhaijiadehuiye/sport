(() => {
  "use strict";

  const canvas = document.getElementById("court");
  const ctx = canvas.getContext("2d");
  const E = window.StickBadmintonEngine;
  const C = E.C;
  const W = C.width;
  const H = C.height;
  const TAU = Math.PI * 2;
  const $ = (id) => document.getElementById(id);
  const keys = new Set();
  const touch = { left: false, right: false, jump: false, swing: false };
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);

  let match = E.createMatch({ mode: "exhibition", player: "sam", opponent: "red", skill: .9 });
  let screen = "menu";
  let muted = false;
  let accumulator = 0;
  let lastTime = 0;
  let raf = 0;
  let toast = "";
  let toastTime = 0;
  let particles = [];
  let shuttleTrail = [];
  let audio = null;

  function showOnly(id) {
    ["menuOverlay", "setupOverlay", "howOverlay", "pauseOverlay", "resultOverlay"]
      .forEach((name) => $(name).classList.toggle("visible", name === id));
  }

  function setStatus(text) {
    $("statusLabel").textContent = text;
  }

  function updateHud() {
    $("scoreLabel").textContent = match.score[0] + " — " + match.score[1];
    $("modeLabel").textContent = match.mode === "local" ? "2 PLAYER" : "EXHIBITION";
    $("connectionLight").innerHTML = "<i></i> " + (muted ? "MUTED" : "LOCAL PLAY");
  }

  function showToast(text, seconds) {
    toast = text;
    toastTime = seconds == null ? .72 : seconds;
  }

  function ensureAudio() {
    if (muted) return null;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      return audio;
    } catch (_) {
      return null;
    }
  }

  function tone(type) {
    const ac = ensureAudio();
    if (!ac) return;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const values = {
      hit: [250, 105, .055, .022],
      smash: [510, 120, .10, .040],
      net: [190, 110, .055, .016],
      point: [390, 650, .17, .026],
      serve: [300, 130, .07, .020]
    }[type] || [250, 105, .06, .02];
    osc.type = type === "smash" ? "sawtooth" : "triangle";
    osc.frequency.setValueAtTime(values[0], now);
    osc.frequency.exponentialRampToValueAtTime(values[1], now + values[2]);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(values[3], now + .006);
    gain.gain.exponentialRampToValueAtTime(.0001, now + values[2]);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + values[2] + .01);
  }

  function menu() {
    screen = "menu";
    showOnly("menuOverlay");
    setStatus("READY");
    updateHud();
  }

  function openSetup(mode) {
    match.mode = mode === "local" ? "local" : "exhibition";
    $("setupTitle").textContent = match.mode === "local" ? "2 PLAYER" : "EXHIBITION";
    $("difficultySetup").style.display = match.mode === "local" ? "none" : "";
    $("opponentSetup").querySelector("span").textContent = match.mode === "local" ? "PLAYER 2" : "OPPONENT";
    showOnly("setupOverlay");
  }

  function startMatch() {
    const mode = match.mode === "local" ? "local" : "exhibition";
    const options = {
      mode,
      player: $("playerSelect").value,
      opponent: $("opponentSelect").value,
      skill: Number($("difficultySelect").value) || .9
    };
    match = E.createMatch(options);
    screen = "match";
    accumulator = 0;
    shuttleTrail = [];
    particles = [];
    toast = "";
    showOnly(null);
    updateHud();
    setStatus("SERVE");
    showToast("READY", .68);
    canvas.focus();
  }

  function exitToMenu() {
    screen = "menu";
    showOnly("menuOverlay");
    setStatus("READY");
  }

  function togglePause() {
    if (screen === "match") {
      screen = "pause";
      showOnly("pauseOverlay");
      setStatus("PAUSED");
    } else if (screen === "pause") {
      screen = "match";
      showOnly(null);
      setStatus(match.phase === "serve" ? "SERVE" : "RALLY");
      canvas.focus();
    }
  }

  function restartMatch() {
    startMatch();
  }

  function inputForPlayers() {
    const p1 = {
      left: keys.has("KeyA") || keys.has("a") || touch.left,
      right: keys.has("KeyD") || keys.has("d") || touch.right,
      jump: keys.has("KeyW") || keys.has("w") || touch.jump,
      swing: keys.has("KeyS") || keys.has("s") || keys.has("Space") || touch.swing
    };
    const p2 = {
      left: keys.has("ArrowLeft"),
      right: keys.has("ArrowRight"),
      jump: keys.has("ArrowUp"),
      swing: keys.has("ArrowDown")
    };
    return { p1, p2 };
  }

  function burst(x, h, color, count) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x,
        h,
        vx: rand(-90, 90),
        vh: rand(35, 150),
        life: rand(.22, .52),
        max: .52,
        size: rand(1.1, 2.7),
        color
      });
    }
  }

  function handleEvents(events) {
    for (const event of events) {
      if (event.type === "hit") {
        const color = event.side === 0 ? "#e9e0ca" : "#e85b5a";
        burst(event.x, event.h, color, event.kind === "smash" ? 7 : 4);
        if (event.kind === "smash") {
          showToast("SMASH", .34);
          tone("smash");
        } else {
          tone(event.kind === "serve" ? "serve" : "hit");
        }
      } else if (event.type === "net") {
        burst(event.x, event.h, "#5d9cae", 4);
        tone("net");
        showToast("NET", .30);
      } else if (event.type === "point") {
        burst(event.x, 7, event.side === 0 ? "#e84345" : "#5bafc2", 16);
        tone("point");
        showToast(event.side === 0 ? "POINT  P1" : "POINT  P2", .72);
        setStatus(event.side === 0 ? "POINT P1" : "POINT P2");
      }
    }
  }

  function simulate(dt) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= C.fixedStep && steps < 18) {
      accumulator -= C.fixedStep;
      const beforePhase = match.shuttle.phase;
      E.step(match, inputForPlayers(), C.fixedStep);
      handleEvents(match.events);
      const after = match.shuttle;
      if (after.phase === "flight") {
        shuttleTrail.push({ x: after.x, h: after.h, life: 1 });
        if (shuttleTrail.length > 13) shuttleTrail.shift();
      } else if (beforePhase === "flight" && after.phase !== "flight") {
        shuttleTrail = [];
      }
      if (match.winner != null) {
        screen = "result";
        $("resultTitle").textContent = match.winner === 0 ? "YOU WIN" : "YOU LOSE";
        $("resultTitle").style.color = match.winner === 0 ? "var(--red)" : "#b9c2bd";
        $("resultPlayerScore").textContent = match.score[0];
        $("resultOpponentScore").textContent = match.score[1];
        $("resultCopy").textContent = match.winner === 0 ? "A clean exhibition win." : "The next rally is yours.";
        $("resultKicker").textContent = match.mode === "local" ? "MATCH COMPLETE" : "EXHIBITION COMPLETE";
        showOnly("resultOverlay");
      }
      steps++;
    }
    if (match.phase === "serve") setStatus("SERVE");
    else if (match.phase === "flight") setStatus("RALLY");
    updateHud();
  }

  function updateParticles(dt) {
    particles = particles.filter((p) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.h += p.vh * dt;
      p.vh -= 290 * dt;
      return p.life > 0;
    });
    shuttleTrail.forEach((p) => { p.life -= dt * 4.2; });
    shuttleTrail = shuttleTrail.filter((p) => p.life > 0);
    if (toastTime > 0) toastTime -= dt;
  }

  function drawBackground() {
    const wall = ctx.createLinearGradient(0, 0, 0, 472);
    wall.addColorStop(0, "#a8aaa0");
    wall.addColorStop(.58, "#949890");
    wall.addColorStop(1, "#7b817b");
    ctx.fillStyle = "#4c5251";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = wall;
    ctx.fillRect(43, 0, 874, 474);
    ctx.fillStyle = "rgba(42,47,46,.25)";
    ctx.fillRect(43, 0, 13, 474);
    ctx.fillRect(904, 0, 13, 474);

    ctx.strokeStyle = "rgba(48,54,52,.43)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(106, 0); ctx.lineTo(106, 473);
    ctx.moveTo(854, 0); ctx.lineTo(854, 473);
    ctx.stroke();
    ctx.strokeStyle = "rgba(224,224,211,.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(109, 0); ctx.lineTo(109, 473);
    ctx.moveTo(857, 0); ctx.lineTo(857, 473);
    ctx.stroke();

    for (let i = 0; i < 260; i++) {
      const x = 52 + (i * 173) % 852;
      const y = 16 + (i * 89) % 445;
      const r = i % 7 === 0 ? 1.35 : .65;
      ctx.fillStyle = i % 3 === 0 ? "rgba(38,44,42,.12)" : "rgba(241,239,222,.13)";
      ctx.fillRect(x, y, r, r);
    }

    ctx.fillStyle = "#55534b";
    ctx.fillRect(0, 472, W, 68);
    const floor = ctx.createLinearGradient(0, 472, 0, 540);
    floor.addColorStop(0, "#a2774d");
    floor.addColorStop(1, "#624a39");
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.moveTo(137, 472);
    ctx.lineTo(823, 472);
    ctx.lineTo(960, 540);
    ctx.lineTo(0, 540);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(38,30,25,.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(137, 472); ctx.lineTo(0, 540);
    ctx.moveTo(823, 472); ctx.lineTo(960, 540);
    ctx.moveTo(480, 472); ctx.lineTo(480, 540);
    ctx.stroke();
    ctx.fillStyle = "rgba(250,226,182,.20)";
    ctx.fillRect(137, 471, 686, 2);
  }

  function drawNet() {
    const leftTop = { x: 466, y: C.ground - C.netTop };
    const rightTop = { x: 493, y: C.ground - C.netTop - 2 };
    const leftBottom = { x: 468, y: C.ground };
    const rightBottom = { x: 492, y: C.ground };
    ctx.save();
    ctx.strokeStyle = "#2b82a0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leftTop.x, leftTop.y); ctx.lineTo(leftBottom.x, leftBottom.y);
    ctx.moveTo(rightTop.x, rightTop.y); ctx.lineTo(rightBottom.x, rightBottom.y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(53,141,165,.62)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x1 = lerp(leftTop.x, leftBottom.x, t);
      const x2 = lerp(rightTop.x, rightBottom.x, t);
      const y1 = lerp(leftTop.y, leftBottom.y, t);
      const y2 = lerp(rightTop.y, rightBottom.y, t);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    for (let i = 0; i <= 7; i++) {
      const t = i / 7;
      const y = lerp(leftTop.y, leftBottom.y, t);
      ctx.beginPath();
      ctx.moveTo(lerp(leftTop.x, rightTop.x, t), y);
      ctx.lineTo(lerp(leftBottom.x, rightBottom.x, t), y + (C.ground - y) * .015);
      ctx.stroke();
    }
    ctx.restore();
  }

  function line(x1, y1, x2, y2, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawRacket(player, active) {
    const phase = player.swingTime > 0 ? 1 - player.swingTime / C.swingDuration : 0;
    const pose = E.worldPose(player, phase);
    const handX = pose.handX;
    const handY = C.ground - pose.handH;
    const tipX = pose.tipX;
    const tipY = C.ground - pose.tipH;
    ctx.save();
    if (active) {
      ctx.strokeStyle = "rgba(255,247,221,.13)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 15, pose.angle + .8, pose.angle + 2.1);
      ctx.stroke();
    }
    line(handX, handY, tipX, tipY, active ? 2.3 : 1.8, "#e8e9df");
    ctx.translate(tipX, tipY);
    ctx.rotate(-pose.angle - Math.PI / 2);
    ctx.strokeStyle = active ? "#fff8e8" : "#d9ddd4";
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.ellipse(0, 0, 6, 13, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawStickPlayer(player) {
    const bob = player.onGround ? Math.sin(match.time * 7 + player.side * 1.4) * .8 : 0;
    const lean = clamp(player.vx / 750, -1, 1) * 3;
    const baseY = C.ground - player.y + bob;
    const x = player.x + lean;
    const side = player.side === 0 ? 1 : -1;
    const red = player.choice === "red";
    const robot = player.choice === "robot";
    const head = red ? "#e84248" : robot ? "#9ad6d2" : "#eee9d9";
    const ink = robot ? "#183036" : "#111719";
    const shoulderY = baseY - 70;
    const hipY = baseY - 31;
    const headY = baseY - 100;
    const active = player.swingTime > 0;
    const pose = E.worldPose(player, active ? 1 - player.swingTime / C.swingDuration : 0);
    const racketHandX = pose.handX;
    const racketHandY = C.ground - pose.handH;

    ctx.save();
    ctx.globalAlpha = .22;
    ctx.fillStyle = "#24251f";
    ctx.beginPath();
    ctx.ellipse(x, C.ground + 1, 22 + Math.abs(player.vx) * .015, 4.3, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    line(x, hipY, x - side * 10, baseY, 3.1, ink);
    line(x, hipY, x + side * 11, baseY, 3.1, ink);
    line(x, shoulderY, x, hipY, 3.3, ink);
    line(x, shoulderY + 3, racketHandX, racketHandY, 3.0, ink);
    const freeHandX = x - side * (active ? 20 : 14);
    const freeHandY = shoulderY + (active ? 21 : 25);
    line(x, shoulderY + 4, freeHandX, freeHandY, 2.8, ink);
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.arc(x, headY, 12.2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    if (player.choice === "sam") {
      ctx.fillStyle = "#111719";
      ctx.fillRect(x - 16, headY - 13, 32, 4);
      ctx.fillRect(x - 10, headY - 22, 20, 10);
      ctx.fillStyle = "#2f3532";
      ctx.fillRect(x - 9, headY - 21, 18, 2);
    } else if (red) {
      ctx.fillStyle = "#9f272f";
      ctx.beginPath();
      ctx.moveTo(x - 11, headY - 8);
      ctx.lineTo(x - 6, headY - 17);
      ctx.lineTo(x - 1, headY - 10);
      ctx.lineTo(x + 6, headY - 18);
      ctx.lineTo(x + 12, headY - 6);
      ctx.closePath();
      ctx.fill();
    } else if (robot) {
      ctx.strokeStyle = "#3f9091";
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x - 5, headY); ctx.lineTo(x + 5, headY); ctx.stroke();
    }
    ctx.restore();
    drawRacket(player, active);
  }

  function drawShuttle() {
    const s = match.shuttle;
    const x = s.x;
    const y = C.ground - s.h;
    const angle = Number.isFinite(s.rotation) ? s.rotation : 0;
    ctx.save();
    for (const p of shuttleTrail) {
      const alpha = clamp(p.life, 0, 1) * .25;
      ctx.fillStyle = "rgba(255,247,219," + alpha + ")";
      ctx.beginPath();
      ctx.arc(p.x, C.ground - p.h, 1.6, 0, TAU);
      ctx.fill();
    }
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = "#f6f0df";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(1, 0);
    ctx.lineTo(-9, -5);
    ctx.lineTo(-12, -2);
    ctx.lineTo(-11, 3);
    ctx.lineTo(-8, 5);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "#d2ae82";
    ctx.beginPath(); ctx.arc(2, 0, 2.6, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, C.ground - p.h, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawCanvasHud() {
    ctx.save();
    ctx.font = "700 12px Courier New, monospace";
    ctx.fillStyle = "rgba(248,247,235,.94)";
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = 2;
    ctx.fillText("P: PAUSE", 16, 22);
    ctx.fillText("M: MUTE", 16, 38);
    ctx.fillText("ESC: EXIT", 16, 54);
    ctx.textAlign = "right";
    ctx.fillText("BADMINTON II", 944, 22);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#111718";
    ctx.fillRect(436, 10, 88, 32);
    ctx.strokeStyle = "rgba(240,237,220,.45)";
    ctx.lineWidth = 1;
    ctx.strokeRect(436.5, 10.5, 87, 31);
    ctx.fillStyle = "#e64b4d";
    ctx.font = "700 20px Courier New, monospace";
    ctx.textAlign = "center";
    ctx.fillText(match.score[0] + "  " + match.score[1], 480, 32);
    if (toastTime > 0 && toast) {
      ctx.globalAlpha = clamp(toastTime * 2, 0, 1);
      ctx.fillStyle = "#f5f1de";
      ctx.font = "700 13px Courier New, monospace";
      ctx.fillText(toast, 480, 77);
    }
    ctx.restore();
  }

  function drawScene() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawNet();
    match.players.slice().sort((a, b) => a.y - b.y).forEach(drawStickPlayer);
    drawShuttle();
    drawParticles();
    drawCanvasHud();
  }

  function frame(time) {
    const dt = Math.min(.08, (time - lastTime) / 1000 || .016);
    lastTime = time;
    if (screen === "match") simulate(dt);
    updateParticles(dt);
    drawScene();
    raf = requestAnimationFrame(frame);
  }

  function normalizedKey(event) {
    return event.code || event.key;
  }

  window.addEventListener("keydown", (event) => {
    const code = normalizedKey(event);
    const lower = String(event.key || "").toLowerCase();
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(code)) event.preventDefault();
    if ((code === "KeyP" || lower === "p") && !event.repeat) { togglePause(); return; }
    if ((code === "KeyM" || lower === "m") && !event.repeat) {
      muted = !muted;
      updateHud();
      if (!muted) tone("hit");
      return;
    }
    if ((code === "Escape" || lower === "escape") && !event.repeat) {
      if (screen === "match" || screen === "pause") exitToMenu();
      else menu();
      return;
    }
    keys.add(code);
    keys.add(lower);
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(normalizedKey(event));
    keys.delete(String(event.key || "").toLowerCase());
  });
  window.addEventListener("blur", () => keys.clear());
  canvas.addEventListener("pointerdown", () => canvas.focus());

  document.querySelectorAll(".touch-controls button").forEach((button) => {
    const action = button.dataset.key;
    const set = (event, value) => {
      event.preventDefault();
      touch[action] = value;
      if (value) button.setPointerCapture?.(event.pointerId);
    };
    button.addEventListener("pointerdown", (event) => set(event, true));
    ["pointerup", "pointercancel", "pointerleave"].forEach((name) => {
      button.addEventListener(name, (event) => set(event, false));
    });
  });

  $("exhibitionBtn").addEventListener("click", () => openSetup("exhibition"));
  $("localBtn").addEventListener("click", () => openSetup("local"));
  $("howBtn").addEventListener("click", () => showOnly("howOverlay"));
  $("howBack").addEventListener("click", menu);
  $("setupBack").addEventListener("click", menu);
  $("howStartBtn").addEventListener("click", () => openSetup("exhibition"));
  $("startMatchBtn").addEventListener("click", startMatch);
  $("resumeBtn").addEventListener("click", togglePause);
  $("pauseExitBtn").addEventListener("click", exitToMenu);
  $("rematchBtn").addEventListener("click", restartMatch);
  $("resultMenuBtn").addEventListener("click", menu);
  $("fullscreenBtn").addEventListener("click", () => {
    const frame = document.querySelector(".game-frame");
    if (!document.fullscreenElement) frame.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  updateHud();
  setStatus("READY");
  showOnly("menuOverlay");
  drawScene();
  raf = requestAnimationFrame(frame);
  window.addEventListener("beforeunload", () => cancelAnimationFrame(raf));
})();
