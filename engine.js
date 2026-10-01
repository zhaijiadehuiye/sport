(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StickBadmintonEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /*
   * The simulation is intentionally independent from the canvas.  The browser
   * renderer and the headless match checks both use these exact rules.
   */
  var C = {
    width: 960,
    height: 540,
    ground: 500,
    netX: 480,
    netTop: 108,
    wallL: 43,
    wallR: 917,
    gravity: 1500,
    playerGravity: 1900,
    fixedStep: 1 / 120,
    swingDuration: 0.30,
    swingContact: 0.64,
    swingWindow: [0.52, 0.77],
    winScore: 7
  };

  var PLAYER_STATS = {
    sam: { maxSpeed: 360, acceleration: 2800, friction: 3600, jumpSpeed: 710 },
    red: { maxSpeed: 414, acceleration: 3200, friction: 3900, jumpSpeed: 650 },
    robot: { maxSpeed: 388, acceleration: 3000, friction: 3750, jumpSpeed: 680 }
  };

  var clamp = function (n, a, b) { return Math.max(a, Math.min(b, n)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var sign = function (n) { return n < 0 ? -1 : n > 0 ? 1 : 0; };
  var approach = function (v, target, amount) {
    if (v < target) return Math.min(v + amount, target);
    if (v > target) return Math.max(v - amount, target);
    return target;
  };
  var angleLerp = function (a, b, t) {
    var d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + d * t;
  };
  var smooth = function (t) { return t * t * (3 - 2 * t); };

  function createPlayer(side, choice, human, skill) {
    var stats = PLAYER_STATS[choice] || PLAYER_STATS.sam;
    return {
      side: side,
      choice: choice || "sam",
      human: !!human,
      skill: skill == null ? 0.9 : skill,
      x: side === 0 ? 210 : 750,
      y: 0,
      vx: 0,
      vy: 0,
      onGround: true,
      facing: side === 0 ? 1 : -1,
      maxSpeed: stats.maxSpeed,
      acceleration: stats.acceleration,
      friction: stats.friction,
      jumpSpeed: stats.jumpSpeed,
      swingTime: 0,
      swingCooldown: 0,
      swingHit: false,
      swingWasActive: false,
      previousPose: null,
      jumpLatch: false,
      aiPlan: null,
      aiPlanRevision: -1,
      aiThink: 0,
      aiTargetX: side === 0 ? 210 : 750,
      aiShotKind: "clear",
      aiLastHit: -1,
      errorSeed: side * 1.71 + 0.37
    };
  }

  function createShuttle() {
    return {
      x: 250,
      h: 106,
      vx: 0,
      vh: 0,
      previousX: 250,
      previousH: 106,
      lastHit: -1,
      age: 0,
      phase: "held",
      netHit: false,
      wallBounces: 0,
      revision: 0,
      rotation: 0,
      trail: []
    };
  }

  function createMatch(options) {
    options = options || {};
    var mode = options.mode === "local" ? "local" : "exhibition";
    var skill = clamp(Number(options.skill == null ? 0.9 : options.skill), 0.55, 1);
    var playerChoice = options.player || "sam";
    var opponentChoice = options.opponent || "red";
    var state = {
      mode: mode,
      skill: skill,
      score: [0, 0],
      serveSide: 0,
      phase: "serve",
      serveClock: 0.62,
      pointClock: 0,
      pointWinner: null,
      winner: null,
      rally: 0,
      time: 0,
      players: [
        createPlayer(0, playerChoice, true, skill),
        createPlayer(1, opponentChoice, mode === "local", skill)
      ],
      shuttle: createShuttle(),
      events: []
    };
    syncHeldShuttle(state);
    return state;
  }

  function resetRally(state, winner) {
    state.serveSide = winner == null ? state.serveSide : winner;
    state.phase = "serve";
    state.serveClock = 0.62;
    state.pointClock = 0;
    state.pointWinner = null;
    state.rally = 0;
    state.shuttle = createShuttle();
    state.players.forEach(function (p, side) {
      p.x = side === 0 ? 210 : 750;
      p.y = 0;
      p.vx = 0;
      p.vy = 0;
      p.onGround = true;
      p.swingTime = 0;
      p.swingCooldown = 0;
      p.swingHit = false;
      p.swingWasActive = false;
      p.aiPlan = null;
      p.aiPlanRevision = -1;
    });
    syncHeldShuttle(state);
  }

  function worldPose(player, phase) {
    var side = player.side === 0 ? 1 : -1;
    var p = phase == null ? swingPhase(player) : clamp(phase, 0, 1);
    var rest = player.side === 0 ? 2.26 : 0.88;
    var back = player.side === 0 ? 2.02 : 1.12;
    var attack = player.side === 0 ? 0.91 : 2.23;
    var follow = player.side === 0 ? 0.70 : 2.44;
    var angle;
    if (phase == null || player.swingTime <= 0) angle = rest;
    else if (p < 0.28) angle = angleLerp(attack, back, smooth(p / 0.28));
    else if (p < 0.72) angle = angleLerp(back, attack, smooth((p - 0.28) / 0.44));
    else angle = angleLerp(attack, follow, smooth((p - 0.72) / 0.28));
    var handX = player.x + side * 17;
    var handH = player.y + 86;
    var length = phase == null || player.swingTime <= 0 ? 42 : 48;
    return {
      handX: handX,
      handH: handH,
      tipX: handX + Math.cos(angle) * length,
      tipH: handH + Math.sin(angle) * length,
      angle: angle,
      phase: p,
      side: side
    };
  }

  function swingPhase(player) {
    return player.swingTime > 0 ? clamp(1 - player.swingTime / C.swingDuration, 0, 1) : 0;
  }

  function racketHeight(player, phase) {
    return worldPose(player, phase).tipH;
  }

  function syncHeldShuttle(state) {
    var server = state.players[state.serveSide];
    var pose = worldPose(server, 0);
    var side = server.side === 0 ? 1 : -1;
    state.shuttle.x = server.x - side * 28;
    state.shuttle.h = server.y + 68;
    state.shuttle.previousX = state.shuttle.x;
    state.shuttle.previousH = state.shuttle.h;
    state.shuttle.rotation = Math.PI / 2;
  }

  function triggerJump(player) {
    if (!player || !player.onGround) return false;
    player.vy = player.jumpSpeed;
    player.onGround = false;
    return true;
  }

  function beginSwing(player) {
    if (!player || player.swingTime > 0 || player.swingCooldown > 0) return false;
    player.swingTime = C.swingDuration;
    player.swingCooldown = 0.17;
    player.swingHit = false;
    return true;
  }

  function shotTarget(player, opponent, kind, h) {
    var side = player.side === 0 ? 1 : -1;
    var deep = side === 1 ? 850 : 110;
    var near = side === 1 ? 412 : 548;
    var body = clamp(opponent.x + side * 26, side === 1 ? 530 : 65, side === 1 ? 895 : 430);
    if (kind === "drop") return near;
    if (kind === "drive") return clamp(body + side * 72, side === 1 ? 535 : 65, side === 1 ? 900 : 425);
    if (kind === "smash") return clamp(body + side * 32, side === 1 ? 530 : 75, side === 1 ? 900 : 425);
    return deep;
  }

  function solveShot(fromX, fromH, player, kind, targetX) {
    var side = player.side === 0 ? 1 : -1;
    var distance = Math.max(80, Math.abs(targetX - fromX));
    var speed = { serve: 650, clear: 720, drop: 555, drive: 930, smash: 1120 }[kind] || 720;
    var g = C.gravity;
    var t = distance / speed;
    var netT = Math.max(0.04, Math.abs(C.netX - fromX) / speed);
    var netH = { serve: 158, clear: 190, drop: 126, drive: 145, smash: 150 }[kind] || 165;
    var targetH = { serve: 34, clear: 34, drop: 24, drive: 46, smash: 38 }[kind] || 34;
    var toTarget = (targetH - fromH + 0.5 * g * t * t) / t;
    var toNet = (netH - fromH + 0.5 * g * netT * netT) / netT;
    var vh = kind === "clear" || kind === "serve" ? toNet : toTarget;
    var projectedNet = fromH + vh * netT - 0.5 * g * netT * netT;
    if (projectedNet < C.netTop + 15) vh += (C.netTop + 15 - projectedNet) / netT;
    vh = clamp(vh, kind === "smash" ? -120 : -20, kind === "clear" ? 880 : 760);
    return { vx: side * speed, vh: vh, targetX: targetX, targetH: targetH, time: t };
  }

  function chooseShot(player, opponent, shuttle) {
    var contactH = racketHeight(player, C.swingContact);
    if (player.human) {
      if (player.y > 45 && contactH > 145) return "smash";
      if (shuttle.h < 92) return "drive";
      return shuttle.h > 145 ? "clear" : "drive";
    }
    if (player.y > 48 && contactH > 145) return "smash";
    var opponentNearNet = player.side === 0 ? opponent.x < 585 : opponent.x > 375;
    if (opponentNearNet && shuttle.h < 145) return "clear";
    if (shuttle.h < 92) return "drive";
    var roll = Math.sin(statefulSeed(player, shuttle.revision)) * 0.5 + 0.5;
    if (roll > 0.70) return "drop";
    if (roll < 0.28) return "drive";
    return "clear";
  }

  function statefulSeed(player, revision) {
    var n = Math.sin((revision + 1) * 12.9898 + player.errorSeed * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  function launchShot(state, player, kind) {
    var shuttle = state.shuttle;
    var opponent = state.players[player.side === 0 ? 1 : 0];
    var targetX = shotTarget(player, opponent, kind, shuttle.h);
    var solved = solveShot(shuttle.x, shuttle.h, player, kind, targetX);
    shuttle.vx = solved.vx;
    shuttle.vh = solved.vh;
    shuttle.phase = "flight";
    state.phase = "flight";
    shuttle.lastHit = player.side;
    shuttle.previousX = shuttle.x;
    shuttle.previousH = shuttle.h;
    shuttle.age = 0;
    shuttle.netHit = false;
    shuttle.wallBounces = 0;
    shuttle.rotation = Math.atan2(-shuttle.vh, shuttle.vx);
    shuttle.revision += 1;
    state.rally += 1;
    state.events.push({ type: "hit", side: player.side, kind: kind, x: shuttle.x, h: shuttle.h });
    player.aiPlan = null;
    player.aiPlanRevision = shuttle.revision;
  }

  function launchServe(state) {
    var server = state.players[state.serveSide];
    var pose = worldPose(server, C.swingContact);
    state.shuttle.x = pose.tipX;
    state.shuttle.h = pose.tipH;
    beginSwing(server);
    server.swingTime = C.swingDuration * (1 - C.swingContact);
    server.swingCooldown = 0.2;
    server.swingHit = true;
    launchShot(state, server, "serve");
  }

  function distanceToPoint(x1, h1, x2, h2) {
    var dx = x1 - x2;
    var dh = h1 - h2;
    return Math.sqrt(dx * dx + dh * dh);
  }

  function canReceive(player, shuttle) {
    if (!shuttle || shuttle.phase !== "flight" || shuttle.lastHit === player.side) return false;
    return player.side === 0 ? shuttle.x <= C.netX + 34 : shuttle.x >= C.netX - 34;
  }

  function checkHit(state, player, previousPose, currentPose) {
    var shuttle = state.shuttle;
    if (!canReceive(player, shuttle) || player.swingHit) return false;
    if (player.swingTime <= 0) return false;
    var phase = swingPhase(player);
    if (phase < C.swingWindow[0] || phase > C.swingWindow[1]) return false;
    var headX = currentPose.tipX;
    var headH = currentPose.tipH;
    var previousHeadX = previousPose.tipX;
    var previousHeadH = previousPose.tipH;
    var d0 = distanceToPoint(shuttle.x, shuttle.h, headX, headH);
    var d1 = distanceToPoint(shuttle.x, shuttle.h, previousHeadX, previousHeadH);
    if (Math.min(d0, d1) > 25) return false;
    player.swingHit = true;
    shuttle.x = headX;
    shuttle.h = headH;
    var kind = chooseShot(player, state.players[player.side === 0 ? 1 : 0], shuttle);
    launchShot(state, player, kind);
    return true;
  }

  function simulateBall(ball, seconds) {
    var b = {
      x: ball.x, h: ball.h, vx: ball.vx, vh: ball.vh,
      previousX: ball.x, previousH: ball.h,
      phase: "flight", netHit: ball.netHit, wallBounces: ball.wallBounces
    };
    var dt = 1 / 120;
    var steps = Math.ceil(seconds / dt);
    for (var i = 0; i < steps; i++) {
      b.previousX = b.x;
      b.previousH = b.h;
      b.x += b.vx * dt;
      b.h += b.vh * dt;
      b.vh -= C.gravity * dt;
      if (b.x < C.wallL) {
        b.x = C.wallL;
        b.vx = Math.abs(b.vx) * 0.78;
        b.wallBounces += 1;
      } else if (b.x > C.wallR) {
        b.x = C.wallR;
        b.vx = -Math.abs(b.vx) * 0.78;
        b.wallBounces += 1;
      }
      if ((b.previousX - C.netX) * (b.x - C.netX) <= 0 && b.h < C.netTop) {
        b.x = C.netX + (b.x < C.netX ? -1 : 1) * 5;
        b.vx *= -0.12;
        b.vh *= 0.22;
        b.netHit = true;
      }
      if (b.h <= 0) return { dead: true, t: (i + 1) * dt, x: b.x, h: 0, vx: b.vx, vh: b.vh };
    }
    return b;
  }

  function predictIntercept(player, shuttle) {
    if (!shuttle || shuttle.phase !== "flight" || shuttle.lastHit === player.side) return null;
    var dt = 1 / 60;
    var b = {
      x: shuttle.x, h: shuttle.h, vx: shuttle.vx, vh: shuttle.vh,
      previousX: shuttle.x, previousH: shuttle.h,
      netHit: shuttle.netHit, wallBounces: shuttle.wallBounces
    };
    var best = null;
    for (var i = 1; i <= 180; i++) {
      b.previousX = b.x;
      b.previousH = b.h;
      b.x += b.vx * dt;
      b.h += b.vh * dt;
      b.vh -= C.gravity * dt;
      if (b.x < C.wallL) {
        b.x = C.wallL;
        b.vx = Math.abs(b.vx) * 0.78;
      } else if (b.x > C.wallR) {
        b.x = C.wallR;
        b.vx = -Math.abs(b.vx) * 0.78;
      }
      if ((b.previousX - C.netX) * (b.x - C.netX) <= 0 && b.h < C.netTop) {
        b.x = C.netX + (b.x < C.netX ? -1 : 1) * 5;
        b.vx *= -0.12;
        b.vh *= 0.22;
      }
      var t = i * dt;
      if (b.h <= 0) break;
      var ownSide = player.side === 0 ? b.x < C.netX + 22 : b.x > C.netX - 22;
      var descending = b.vh < 470;
      var contactH = b.h;
      var requiredY = clamp(contactH - 132, 0, player.jumpSpeed * player.jumpSpeed / (2 * C.playerGravity) - 6);
      // The target is the player's root position.  The racket head sits
      // about 39px toward the net from that root at contact.
      var targetX = b.x - (player.side === 0 ? 25 : -25);
      var reachTime = Math.max(0, t - 0.04);
      var accelerateTime = player.maxSpeed / player.acceleration;
      var reachDistance = reachTime <= accelerateTime
        ? 0.5 * player.acceleration * reachTime * reachTime
        : player.maxSpeed * (reachTime - accelerateTime * 0.5);
      var reachable = Math.abs(targetX - player.x) <= reachDistance + 30;
      if (ownSide && b.h >= 82 && b.h <= 232 && descending && reachable) {
        var desirability = t + Math.abs(contactH - 112) * 0.00065 + (requiredY > 75 ? 0.035 : 0);
        if (!best || desirability < best.score) {
          best = {
            t: t, x: b.x, h: b.h, vh: b.vh,
            targetX: targetX, requiredY: requiredY, score: desirability
          };
        }
      }
    }
    return best;
  }

  function planAI(player, state) {
    var shuttle = state.shuttle;
    var plan = predictIntercept(player, shuttle);
    if (!plan) {
      player.aiPlan = null;
      player.aiPlanRevision = shuttle.revision;
      return null;
    }
    var opponent = state.players[player.side === 0 ? 1 : 0];
    var contactH = plan.h;
    var kind;
    if (contactH > 165 && plan.requiredY > 35) kind = "smash";
    else if (contactH < 88) kind = "drive";
    else if ((opponent.x < 590 && player.side === 0) || (opponent.x > 370 && player.side === 1)) kind = "clear";
    else {
      var roll = statefulSeed(player, shuttle.revision);
      kind = roll > 0.72 ? "drop" : roll < 0.26 ? "drive" : "clear";
    }
    player.aiShotKind = kind;
    player.aiPlan = plan;
    player.aiPlanRevision = shuttle.revision;
    return plan;
  }

  function aiInput(player, state) {
    if (player.human || state.mode === "local") return { left: false, right: false, jump: false, swing: false };
    var shuttle = state.shuttle;
    if (shuttle.phase !== "flight" || shuttle.lastHit === player.side) return { left: false, right: false, jump: false, swing: false };
    if (!player.aiPlan || player.aiPlanRevision !== shuttle.revision || player.aiThink <= 0) {
      player.aiThink = 0.022 + (1 - state.skill) * 0.035;
      if (!player.aiPlan || player.aiPlanRevision !== shuttle.revision) planAI(player, state);
    }
    player.aiThink -= C.fixedStep;
    var plan = player.aiPlan;
    if (!plan) {
      // A trajectory can be temporarily unresolvable just after a wall or
      // net interaction.  Keep moving toward the playable receiving lane so
      // the AI is already in position when a later sample becomes reachable.
      var lane = player.side === 0 ? C.netX - 46 : C.netX + 46;
      return {
        left: player.x > lane + 12,
        right: player.x < lane - 12,
        jump: false,
        swing: false
      };
    }
    var reaction = 0.022 + (1 - state.skill) * 0.085;
    var remaining = Math.max(0, plan.t - (state.time - (plan.startTime || state.time)));
    if (!plan.startTime) {
      plan.startTime = state.time;
      remaining = plan.t;
    }
    var error = (1 - state.skill) * 17 * Math.sin(state.time * 6 + player.errorSeed);
    var target = plan.targetX + error;
    var left = player.x > target + 11;
    var right = player.x < target - 11;
    var jump = false;
    if (plan.requiredY > 20 && player.onGround) {
      var jumpVelocity = player.jumpSpeed;
      var jumpGravity = C.playerGravity;
      var discriminant = Math.max(0, jumpVelocity * jumpVelocity - 2 * jumpGravity * plan.requiredY);
      var riseTime = (jumpVelocity - Math.sqrt(discriminant)) / jumpGravity;
      var lead = Math.max(0.018, riseTime - reaction);
      jump = remaining <= lead + reaction;
    }
    var swing = remaining <= 0.19 - reaction * 0.25;
    if (!swing && Math.abs(shuttle.x - player.x) < 90 && shuttle.h > 45 && shuttle.h < 245) swing = true;
    return { left: left, right: right, jump: jump, swing: swing };
  }

  function integratePlayer(player, input, dt) {
    input = input || {};
    player.previousPose = worldPose(player);
    var axis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (axis) {
      player.facing = axis;
      player.vx = approach(player.vx, axis * player.maxSpeed, player.acceleration * dt);
    } else {
      player.vx = approach(player.vx, 0, player.friction * dt);
    }
    player.x += player.vx * dt;
    var minX = player.side === 0 ? C.wallL + 22 : C.netX + 22;
    var maxX = player.side === 0 ? C.netX - 22 : C.wallR - 22;
    player.x = clamp(player.x, minX, maxX);
    if (input.jump && !player.jumpLatch) triggerJump(player);
    player.jumpLatch = !!input.jump;
    if (player.y > 0 || player.vy > 0) {
      player.y += player.vy * dt;
      player.vy -= C.playerGravity * dt;
      if (player.y <= 0) {
        player.y = 0;
        player.vy = 0;
        player.onGround = true;
      } else {
        player.onGround = false;
      }
    }
    if (player.swingCooldown > 0) player.swingCooldown = Math.max(0, player.swingCooldown - dt);
    if (player.swingTime > 0) player.swingTime = Math.max(0, player.swingTime - dt);
    if (input.swing && player.swingTime <= 0 && player.swingCooldown <= 0) beginSwing(player);
  }

  function updateShuttle(state, dt) {
    var s = state.shuttle;
    if (s.phase !== "flight") return;
    s.previousX = s.x;
    s.previousH = s.h;
    s.x += s.vx * dt;
    s.h += s.vh * dt;
    s.vh -= C.gravity * dt;
    s.age += dt;
    s.rotation = Math.atan2(-s.vh, s.vx || 1);
    if (s.x < C.wallL) {
      s.x = C.wallL;
      s.vx = Math.abs(s.vx) * 0.78;
      s.wallBounces += 1;
      state.events.push({ type: "wall", x: s.x, h: s.h });
    } else if (s.x > C.wallR) {
      s.x = C.wallR;
      s.vx = -Math.abs(s.vx) * 0.78;
      s.wallBounces += 1;
      state.events.push({ type: "wall", x: s.x, h: s.h });
    }
    if ((s.previousX - C.netX) * (s.x - C.netX) <= 0 && s.h < C.netTop) {
      s.x = C.netX + (s.x < C.netX ? -1 : 1) * 5;
      s.vx *= -0.12;
      s.vh *= 0.22;
      s.netHit = true;
      s.revision += 1;
      state.events.push({ type: "net", x: s.x, h: s.h });
    }
    if (s.h <= 0) {
      s.h = 0;
      s.phase = "point";
      state.phase = "point";
      state.pointWinner = s.x < C.netX ? 1 : 0;
      state.score[state.pointWinner] += 1;
      state.pointClock = 0.82;
      state.events.push({ type: "point", side: state.pointWinner, x: s.x });
    }
  }

  function step(state, input, dt) {
    dt = dt == null ? C.fixedStep : Math.min(C.fixedStep, Math.max(0, dt));
    if (!state || state.winner != null) return state;
    state.events.length = 0;
    state.time += dt;
    var p1 = (input && input.p1) || {};
    var p2 = (input && input.p2) || {};
    var ai = aiInput(state.players[1], state);
    var in2 = state.mode === "local" ? p2 : ai;
    state.players.forEach(function (p, side) {
      integratePlayer(p, side === 0 ? p1 : in2, dt);
    });
    if (state.phase === "serve") {
      state.serveClock -= dt;
      syncHeldShuttle(state);
      if (state.serveClock <= 0 || p1.swing || (state.mode === "local" && p2.swing)) launchServe(state);
      return state;
    }
    if (state.phase === "point") {
      state.pointClock -= dt;
      if (state.pointClock <= 0) {
        if (state.score[0] >= C.winScore || state.score[1] >= C.winScore) {
          state.winner = state.score[0] >= C.winScore ? 0 : 1;
        } else resetRally(state, state.pointWinner);
      }
      return state;
    }
    state.players.forEach(function (p) {
      var was = p.previousPose || worldPose(p, 0);
      var now = worldPose(p, swingPhase(p));
      checkHit(state, p, was, now);
      p.swingWasActive = p.swingTime > 0;
    });
    updateShuttle(state, dt);
    return state;
  }

  return {
    C: C,
    createMatch: createMatch,
    createPlayer: createPlayer,
    createShuttle: createShuttle,
    resetRally: resetRally,
    step: step,
    triggerJump: triggerJump,
    beginSwing: beginSwing,
    worldPose: worldPose,
    racketHeight: racketHeight,
    canReceive: canReceive,
    predictIntercept: predictIntercept,
    aiInput: aiInput,
    planAI: planAI,
    launchShot: launchShot,
    solveShot: solveShot,
    simulateBall: simulateBall
  };
});
