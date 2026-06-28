(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  // Logical game resolution stays fixed; the actual pixel buffer is scaled
  // up for the device's pixel ratio so the canvas stays crisp on hi-DPI
  // screens instead of looking soft/blurry.
  const W = 400;
  const H = 600;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  ctx.scale(DPR, DPR);

  const scoreEl = document.getElementById("score");
  const speedEl = document.getElementById("speed");
  const hiscoreEl = document.getElementById("hiscore");

  const startScreen = document.getElementById("startScreen");
  const gameOverScreen = document.getElementById("gameOverScreen");
  const finalScoreEl = document.getElementById("finalScore");
  const newHighEl = document.getElementById("newHigh");

  const leftBtn = document.getElementById("leftBtn");
  const rightBtn = document.getElementById("rightBtn");
  const muteBtn = document.getElementById("muteBtn");
  const gamepadIndicator = document.getElementById("gamepadIndicator");

  const ROAD_W = 280;
  const ROAD_X = (W - ROAD_W) / 2;
  const LANES = 3;
  const LANE_W = ROAD_W / LANES;

  const COLORS = ["#ff2e88", "#ffd23f", "#39ff14", "#ff8a3d", "#00f0ff"];

  // 9x14 pixel-art car sprite (top-down). Reused for every car on screen,
  // just recolored, so traffic doesn't cost extra draw complexity.
  const CAR_SPRITE = [
    "..XXXXX..",
    ".XHXXXHX.",
    "OXXXXXXXO",
    "XX.....XX",
    "XX.WWW.XX",
    "XX.WWW.XX",
    "XX.....XX",
    "XX.....XX",
    "XX.....XX",
    "XX.WWW.XX",
    "XX.....XX",
    "OXXXXXXXO",
    ".XTXXXTX.",
    "..XXXXX..",
  ];

  // ---------------------------------------------------------------
  // Audio: small Web Audio engine. Everything is synthesized, no
  // sample files needed. Context is unlocked on first user gesture
  // because browsers block autoplay before that.
  // ---------------------------------------------------------------
  const SFX = (() => {
    let ctxA = null;
    let master = null;
    let engineOsc = null;
    let engineFilter = null;
    let engineGain = null;
    let noiseBuffer = null;
    let muted = localStorage.getItem("retroRacerMuted") === "1";

    function ensureContext() {
      if (ctxA) return;
      ctxA = new (window.AudioContext || window.webkitAudioContext)();

      master = ctxA.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctxA.destination);

      const len = Math.floor(ctxA.sampleRate * 0.4);
      noiseBuffer = ctxA.createBuffer(1, len, ctxA.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      engineOsc = ctxA.createOscillator();
      engineOsc.type = "sawtooth";
      engineFilter = ctxA.createBiquadFilter();
      engineFilter.type = "lowpass";
      engineFilter.frequency.value = 300;
      engineGain = ctxA.createGain();
      engineGain.gain.value = 0;

      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
    }

    function tone({ freq = 440, duration = 0.15, type = "square", vol = 0.2, sweepTo = null }) {
      if (!ctxA) return;
      const osc = ctxA.createOscillator();
      const gain = ctxA.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctxA.currentTime);
      if (sweepTo !== null) {
        osc.frequency.linearRampToValueAtTime(sweepTo, ctxA.currentTime + duration);
      }
      gain.gain.setValueAtTime(vol, ctxA.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctxA.currentTime + duration);
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      osc.stop(ctxA.currentTime + duration + 0.02);
    }

    return {
      init() {
        ensureContext();
        if (ctxA.state === "suspended") ctxA.resume();
      },
      setEngine(active, speedRatio = 0) {
        if (!ctxA) return;
        const t = ctxA.currentTime + 0.1;
        engineGain.gain.linearRampToValueAtTime(active ? 0.045 : 0, t);
        engineOsc.frequency.linearRampToValueAtTime(70 + speedRatio * 140, t);
        engineFilter.frequency.linearRampToValueAtTime(300 + speedRatio * 600, t);
      },
      playClick() {
        tone({ freq: 520, duration: 0.08, type: "square", vol: 0.15 });
      },
      playCoin() {
        tone({ freq: 880, duration: 0.07, type: "square", vol: 0.18 });
        setTimeout(() => tone({ freq: 1320, duration: 0.09, type: "square", vol: 0.15 }), 55);
      },
      playBoost() {
        tone({ freq: 220, duration: 0.35, type: "sawtooth", vol: 0.2, sweepTo: 880 });
      },
      playCrash() {
        if (!ctxA) return;
        const src = ctxA.createBufferSource();
        src.buffer = noiseBuffer;
        const gain = ctxA.createGain();
        gain.gain.setValueAtTime(0.4, ctxA.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctxA.currentTime + 0.4);
        const filt = ctxA.createBiquadFilter();
        filt.type = "lowpass";
        filt.frequency.value = 1200;
        src.connect(filt);
        filt.connect(gain);
        gain.connect(master);
        src.start();

        tone({ freq: 160, duration: 0.3, type: "sawtooth", vol: 0.3, sweepTo: 40 });
      },
      toggleMute() {
        muted = !muted;
        localStorage.setItem("retroRacerMuted", muted ? "1" : "0");
        if (master) master.gain.linearRampToValueAtTime(muted ? 0 : 0.5, ctxA.currentTime + 0.1);
        return muted;
      },
      isMuted() {
        return muted;
      },
    };
  })();

  muteBtn.textContent = SFX.isMuted() ? "\u{1F507}" : "\u{1F50A}";

  function unlockAudioOnce() {
    SFX.init();
    window.removeEventListener("keydown", unlockAudioOnce);
    window.removeEventListener("pointerdown", unlockAudioOnce);
  }
  window.addEventListener("keydown", unlockAudioOnce, { once: true });
  window.addEventListener("pointerdown", unlockAudioOnce, { once: true });

  muteBtn.addEventListener("click", () => {
    const m = SFX.toggleMute();
    muteBtn.textContent = m ? "\u{1F507}" : "\u{1F50A}";
  });

  // ---------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------
  let state = "start"; // start | playing | paused | crashing | gameover

  let player;
  let obstacles;
  let pickups;
  let particles;
  let scorePopups;

  let score;
  let speed;
  let spawnTimer;
  let pickupTimer;
  let boostTimer;
  let crashTimer;

  let shakeTime = 0;
  let shakeMag = 0;
  let frameCount = 0;

  let keys = { left: false, right: false };

  let hiscore = parseInt(localStorage.getItem("retroRacerHighScore")) || 0;
  hiscoreEl.textContent = hiscore.toString().padStart(6, "0");

  function pad(v, l) {
    return Math.floor(v).toString().padStart(l, "0");
  }

  function resetGame() {
    player = { x: W / 2, y: H - 100, w: 38, h: 58, vx: 0 };

    obstacles = [];
    pickups = [];
    particles = [];
    scorePopups = [];

    score = 0;
    speed = 3;
    spawnTimer = 0;
    pickupTimer = 0;
    boostTimer = 0;
    crashTimer = 0;
    shakeTime = 0;

    scoreEl.textContent = "000000";
    speedEl.textContent = "054";
  }

  function startGame() {
    resetGame();
    state = "playing";

    startScreen.classList.add("hidden");
    gameOverScreen.classList.add("hidden");
    newHighEl.classList.add("hidden");

    SFX.playClick();
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      SFX.setEngine(false);
    } else if (state === "paused") {
      state = "playing";
    }
  }

  function triggerCrash(color) {
    state = "crashing";
    crashTimer = 40;
    spawnExplosion(player.x, player.y, color || "#ff2e88");
    triggerShake(6, 20);
    SFX.playCrash();
    SFX.setEngine(false);
  }

  function gameOver() {
    state = "gameover";

    finalScoreEl.textContent = "SCORE " + pad(score, 6);

    if (score > hiscore) {
      hiscore = Math.floor(score);
      localStorage.setItem("retroRacerHighScore", hiscore);
      hiscoreEl.textContent = pad(hiscore, 6);
      newHighEl.classList.remove("hidden");
    }

    gameOverScreen.classList.remove("hidden");
  }

  // ---------------------------------------------------------------
  // Spawning — always leaves at least one lane open near the top of
  // the screen so the game never produces an impossible 3-lane wall.
  // ---------------------------------------------------------------
  function computeOccupiedLanes(yThreshold) {
    const occ = new Set();
    for (const o of obstacles) {
      if (o.y < yThreshold) {
        for (const l of o.lanes) occ.add(l);
      }
    }
    return occ;
  }

  function pickFreeLane(occ) {
    const free = [];
    for (let l = 0; l < LANES; l++) if (!occ.has(l)) free.push(l);
    if (free.length === 0) return Math.floor(Math.random() * LANES);
    return free[Math.floor(Math.random() * free.length)];
  }

  function spawnCar() {
    const occ = computeOccupiedLanes(170);
    if (occ.size >= LANES) return;

    const canGoWide = score > 260 && LANES - occ.size >= 2 && Math.random() < 0.16;
    let lanes;

    if (canGoWide) {
      const pairs = [];
      for (let l = 0; l < LANES - 1; l++) {
        if (!occ.has(l) && !occ.has(l + 1)) pairs.push([l, l + 1]);
      }
      lanes = pairs.length ? pairs[Math.floor(Math.random() * pairs.length)] : [pickFreeLane(occ)];
    } else {
      lanes = [pickFreeLane(occ)];
    }

    const wide = lanes.length > 1;
    const w = wide ? 112 : 36;
    const h = wide ? 72 : 56;
    const cx = ROAD_X + (lanes[0] + lanes.length / 2) * LANE_W;

    obstacles.push({
      x: cx,
      y: -h,
      w,
      h,
      lanes,
      color: wide ? "#9aa0a6" : COLORS[Math.floor(Math.random() * COLORS.length)],
      speedMult: 0.85 + Math.random() * 0.3,
    });
  }

  function spawnPickup() {
    const occ = computeOccupiedLanes(170);
    const lane = pickFreeLane(occ);
    const isBoost = Math.random() < 0.22;

    pickups.push({
      x: ROAD_X + lane * LANE_W + LANE_W / 2,
      y: -30,
      type: isBoost ? "boost" : "coin",
      w: 22,
      h: 22,
    });
  }

  // ---------------------------------------------------------------
  // Particles / popups / shake
  // ---------------------------------------------------------------
  function spawnExplosion(x, y, color) {
    for (let i = 0; i < 18; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 1 + Math.random() * 4;
      particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 1,
        size: 3 + Math.random() * 4,
        life: 30 + Math.random() * 20,
        maxLife: 50,
        color: Math.random() < 0.5 ? color : "#ffd23f",
      });
    }
  }

  function triggerShake(mag, time) {
    shakeMag = mag;
    shakeTime = time;
  }

  function spawnScorePopup(x, y, text, color) {
    scorePopups.push({ x, y, text, color, life: 45, maxLife: 45 });
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function updateScorePopups() {
    for (let i = scorePopups.length - 1; i >= 0; i--) {
      const s = scorePopups[i];
      s.y -= 0.6;
      s.life--;
      if (s.life <= 0) scorePopups.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------
  function drawRoad() {
    ctx.fillStyle = "#1c3d1f";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#1f1830";
    ctx.fillRect(ROAD_X, 0, ROAD_W, H);

    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(ROAD_X - 4, 0, 4, H);
    ctx.fillRect(ROAD_X + ROAD_W, 0, 4, H);

    ctx.fillStyle = "#ffffff";
    for (let lane = 1; lane < LANES; lane++) {
      const x = ROAD_X + lane * LANE_W - 2;
      for (let y = -40; y < H; y += 50) {
        ctx.fillRect(x, y, 4, 25);
      }
    }
  }

  function drawPixelCar(x, y, w, h, bodyColor) {
    const cols = CAR_SPRITE[0].length;
    const rows = CAR_SPRITE.length;
    const cw = w / cols;
    const ch = h / rows;

    ctx.save();
    ctx.translate(x - w / 2, y - h / 2);

    for (let r = 0; r < rows; r++) {
      const rowStr = CAR_SPRITE[r];
      for (let c = 0; c < cols; c++) {
        const sym = rowStr[c];
        if (sym === ".") continue;

        let fill = bodyColor;
        if (sym === "O") fill = "#0c0c12";
        else if (sym === "W") fill = "#0a1622";
        else if (sym === "H") fill = "#fff6c2";
        else if (sym === "T") fill = "#ff3b3b";

        ctx.fillStyle = fill;
        ctx.fillRect(Math.floor(c * cw), Math.floor(r * ch), Math.ceil(cw) + 1, Math.ceil(ch) + 1);
      }
    }

    ctx.restore();
  }

  function drawCoin(x, y, t) {
    const pulse = 1 + Math.sin(t * 0.15) * 0.15;
    const s = 13 * pulse;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.fillStyle = "#946b00";
    ctx.fillRect(-s / 2 + 3, -s / 2 + 3, Math.max(0, s - 6), Math.max(0, s - 6));
    ctx.restore();
  }

  function drawBoostPickup(x, y, t) {
    const pulse = 1 + Math.sin(t * 0.2) * 0.12;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = "#39ff14";
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(8, 0);
    ctx.lineTo(2, 0);
    ctx.lineTo(8, 14);
    ctx.lineTo(-8, 2);
    ctx.lineTo(-2, 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawBoostTrail(p, t) {
    for (let i = 0; i < 3; i++) {
      const off = (t * 4 + i * 8) % 40;
      ctx.globalAlpha = 0.5 - i * 0.12;
      ctx.fillStyle = "#39ff14";
      ctx.fillRect(p.x - 3, p.y + p.h / 2 + off, 6, 10);
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawScorePopups() {
    ctx.font = "10px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    for (const s of scorePopups) {
      ctx.globalAlpha = Math.max(0, s.life / s.maxLife);
      ctx.fillStyle = s.color;
      ctx.fillText(s.text, s.x, s.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }

  // ---------------------------------------------------------------
  // Gamepad input (standard mapping: left stick / d-pad to steer,
  // face button to confirm, start/options button to pause)
  // ---------------------------------------------------------------
  let gpLeft = false;
  let gpRight = false;
  let gpStartPrev = false;
  let gpPausePrev = false;
  let gamepadActive = false;

  window.addEventListener("gamepadconnected", () => {
    gamepadActive = true;
    gamepadIndicator.classList.add("active");
  });

  window.addEventListener("gamepaddisconnected", () => {
    gamepadActive = false;
    gpLeft = false;
    gpRight = false;
    gamepadIndicator.classList.remove("active");
  });

  function pollGamepad() {
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let pad = null;
    for (const p of pads) {
      if (p) {
        pad = p;
        break;
      }
    }

    if (!pad) {
      gpLeft = false;
      gpRight = false;
      return;
    }

    if (!gamepadActive) {
      gamepadActive = true;
      gamepadIndicator.classList.add("active");
    }

    const axisX = pad.axes[0] || 0;
    const deadzone = 0.22;
    const dpadLeft = pad.buttons[14] && pad.buttons[14].pressed;
    const dpadRight = pad.buttons[15] && pad.buttons[15].pressed;

    gpLeft = axisX < -deadzone || !!dpadLeft;
    gpRight = axisX > deadzone || !!dpadRight;

    const startPressed = !!(pad.buttons[0] && pad.buttons[0].pressed);
    const pausePressed = !!(pad.buttons[9] && pad.buttons[9].pressed);

    if (startPressed && !gpStartPrev) {
      if (state === "start" || state === "gameover") startGame();
    }
    if (pausePressed && !gpPausePrev) {
      if (state === "playing" || state === "paused") togglePause();
    }

    gpStartPrev = startPressed;
    gpPausePrev = pausePressed;
  }

  // ---------------------------------------------------------------
  // Update / render / loop
  // ---------------------------------------------------------------
  function update() {
    if (boostTimer > 0) boostTimer--;
    const boosting = boostTimer > 0;

    speed = Math.min(10, 3 + score / 800) + (boosting ? 3 : 0);

    if (keys.left || gpLeft) player.vx -= 0.5;
    if (keys.right || gpRight) player.vx += 0.5;

    player.vx *= 0.85;
    player.x += player.vx;

    const minX = ROAD_X + player.w / 2;
    const maxX = ROAD_X + ROAD_W - player.w / 2;
    player.x = Math.max(minX, Math.min(maxX, player.x));

    spawnTimer++;
    const spawnInterval = Math.max(16, 40 - score / 150);
    if (spawnTimer >= spawnInterval) {
      spawnTimer = 0;
      spawnCar();
    }

    pickupTimer++;
    if (pickupTimer >= 150) {
      pickupTimer = 0;
      spawnPickup();
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.y += speed * 2.5 * o.speedMult;

      if (o.y > H + 100) {
        obstacles.splice(i, 1);
        continue;
      }

      const gapX = (player.w + o.w) / 2 - 6;
      const gapY = (player.h + o.h) / 2 - 8;
      if (Math.abs(o.x - player.x) < gapX && Math.abs(o.y - player.y) < gapY) {
        triggerCrash(o.color);
        return;
      }
    }

    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.y += speed * 2.5;

      if (p.y > H + 60) {
        pickups.splice(i, 1);
        continue;
      }

      const gapX = (player.w + p.w) / 2 - 4;
      const gapY = (player.h + p.h) / 2 - 4;
      if (Math.abs(p.x - player.x) < gapX && Math.abs(p.y - player.y) < gapY) {
        pickups.splice(i, 1);

        if (p.type === "coin") {
          score += 80;
          SFX.playCoin();
          spawnScorePopup(p.x, p.y, "+80", "#39ff14");
        } else {
          boostTimer = 180;
          SFX.playBoost();
          spawnScorePopup(p.x, p.y, "BOOST!", "#39ff14");
        }
      }
    }

    score += speed * 0.2 * (boosting ? 2 : 1);

    scoreEl.textContent = pad(score, 6);
    speedEl.textContent = pad(speed * 18, 3);

    const speedRatio = Math.max(0, Math.min(1, (speed - 3) / 7));
    SFX.setEngine(true, speedRatio);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    let sx = 0;
    let sy = 0;
    if (shakeTime > 0) {
      sx = (Math.random() * 2 - 1) * shakeMag;
      sy = (Math.random() * 2 - 1) * shakeMag;
      shakeTime--;
    }

    ctx.save();
    ctx.translate(sx, sy);

    drawRoad();

    for (const o of obstacles) {
      drawPixelCar(o.x, o.y, o.w, o.h, o.color);
    }

    for (const p of pickups) {
      if (p.type === "coin") drawCoin(p.x, p.y, frameCount);
      else drawBoostPickup(p.x, p.y, frameCount);
    }

    if (state !== "crashing" && state !== "start") {
      if (boostTimer > 0 && state === "playing") drawBoostTrail(player, frameCount);
      drawPixelCar(player.x, player.y, player.w, player.h, "#00f0ff");
    }

    drawParticles();
    drawScorePopups();

    ctx.restore();

    if (state === "paused") {
      ctx.fillStyle = "rgba(10,0,20,0.7)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#00f0ff";
      ctx.font = "20px 'Press Start 2P', monospace";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", W / 2, H / 2);
      ctx.font = "9px 'Press Start 2P', monospace";
      ctx.fillStyle = "#f2e8c9";
      ctx.fillText("PRESS P TO RESUME", W / 2, H / 2 + 28);
      ctx.textAlign = "left";
    }
  }

  function loop() {
    frameCount++;
    pollGamepad();

    if (state === "playing") {
      update();
    } else if (state === "crashing") {
      crashTimer--;
      if (crashTimer <= 0) gameOver();
    }

    updateParticles();
    updateScorePopups();

    render();
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = true;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = true;

    if (e.key === "Enter") {
      e.preventDefault();
      if (state === "start" || state === "gameover") startGame();
    }

    if (e.key === "p" || e.key === "P" || e.key === "Escape") {
      if (state === "playing" || state === "paused") togglePause();
    }

    if (e.key === "m" || e.key === "M") {
      const m = SFX.toggleMute();
      muteBtn.textContent = m ? "\u{1F507}" : "\u{1F50A}";
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
  });

  startScreen.addEventListener("click", () => {
    if (state !== "playing") startGame();
  });

  gameOverScreen.addEventListener("click", () => {
    if (state === "gameover") startGame();
  });

  function bindHold(el, on, off) {
    const start = (e) => {
      e.preventDefault();
      on();
    };
    const end = (e) => {
      e.preventDefault();
      off();
    };
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("mousedown", start);
    el.addEventListener("mouseup", end);
    el.addEventListener("mouseleave", end);
  }

  bindHold(
    leftBtn,
    () => (keys.left = true),
    () => (keys.left = false)
  );
  bindHold(
    rightBtn,
    () => (keys.right = true),
    () => (keys.right = false)
  );

  resetGame();
  render();
  loop();
})();
