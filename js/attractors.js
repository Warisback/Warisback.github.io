/* ============================================================
   Strange-attractor wisps.
   Short particle trails advected through a 3D chaotic system.
   The canvas is cleared and every trail redrawn each frame, so
   nothing ever accumulates: each streak is born at the seed point,
   ages, and fades away exponentially.

   The seed point follows the pointer (mouse, pen or finger) while
   it moves. When it is idle, a virtual cursor sweeps a slow
   Lissajous path through the field. The seed point eases towards
   whichever target is active, so the flow never jumps.
   ============================================================ */

(function () {
  "use strict";

  const canvas = document.getElementById("attractor-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  /* ---------- attractor definitions ----------
     u:     pixels per state unit, as a fraction of min(w,h)
     rate:  time multiplier fed to the integrator
     cap:   max integrator step (state time)
     seed:  screen offset (in state units) -> initial [x,y,z]
     f:     the system derivative
     proj:  state -> [x,y] in state units (screen offset)      */
  const ATTRACTORS = [
    {
      name: "Lorenz", u: 1 / 165, rate: 0.36, cap: 0.01,
      seed: (dx, dy, s) => { s[0] = dx; s[1] = dx; s[2] = dy + 25; },
      f: (x, y, z, d) => {
        d[0] = 10 * (y - x);
        d[1] = x * (28 - z) - y;
        d[2] = x * y - (8 / 3) * z;
      },
      proj: (s, o) => { o[0] = s[0]; o[1] = s[2] - 25; },
    },
    {
      name: "Thomas", u: 1 / 8.5, rate: 3.0, cap: 0.05,
      seed: (dx, dy, s) => { s[0] = dx; s[1] = dy; s[2] = (dx - dy) / 2; },
      f: (x, y, z, d) => {
        const b = 0.208186;
        d[0] = Math.sin(y) - b * x;
        d[1] = Math.sin(z) - b * y;
        d[2] = Math.sin(x) - b * z;
      },
      proj: (s, o) => { o[0] = s[0]; o[1] = s[1]; },
    },
    {
      name: "Aizawa", u: 1 / 3.2, rate: 1.1, cap: 0.012,
      seed: (dx, dy, s) => { s[0] = dx; s[1] = 0.2; s[2] = dy + 0.55; },
      f: (x, y, z, d) => {
        const a = 0.95, b = 0.7, c = 0.6, e = 0.25, ff = 0.1;
        d[0] = (z - b) * x - 3.5 * y;
        d[1] = 3.5 * x + (z - b) * y;
        d[2] = c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + ff * z * x * x * x;
      },
      proj: (s, o) => { o[0] = s[0]; o[1] = s[2] - 0.55; },
    },
    {
      name: "Halvorsen", u: 1 / 26, rate: 0.5, cap: 0.01,
      seed: (dx, dy, s) => { s[0] = dx - 2; s[1] = dy - 2; s[2] = -2; },
      f: (x, y, z, d) => {
        const a = 1.89;
        d[0] = -a * x - 4 * y - 4 * z - y * y;
        d[1] = -a * y - 4 * z - 4 * x - z * z;
        d[2] = -a * z - 4 * x - 4 * y - x * x;
      },
      proj: (s, o) => { o[0] = s[0] + 2; o[1] = s[1] + 2; },
    },
    {
      name: "Dadras", u: 1 / 24, rate: 0.55, cap: 0.012,
      seed: (dx, dy, s) => { s[0] = dx; s[1] = dy * 0.8; s[2] = dy; },
      f: (x, y, z, d) => {
        d[0] = y - 3 * x + 2.7 * y * z;
        d[1] = 1.7 * y - x * z + z;
        d[2] = 2 * x * y - 9 * z;
      },
      proj: (s, o) => { o[0] = s[0]; o[1] = s[2]; },
    },
  ];

  /* ---------- tuning ---------- */
  const TRAIL = 40;          // points kept per streak
  const TICK = 1 / 60;       // s of simulation between trail points, whatever the frame rate
  const FADE = 1.2;          // exponential age fade, per second
  const SPAWN_RATE = 180;    // streaks seeded per second (not per frame, so 120 Hz screens match 60 Hz)
  const MAX_PARTICLES = 700;
  const JITTER = 6;          // CSS px of scatter around the seed point
  const POINTER_HOLD = 1.4;  // s the pointer stays in charge after it stops moving
  const ALPHA_STEPS = 64;    // stroke opacity is quantised so styles can be cached
  const PIXEL_BUDGET = 2.4e6; // max backing-store pixels for the canvas

  /* ---------- state ---------- */
  let current = 0;
  let W = 0, H = 0, DPR = 1, minDim = 0;   // CSS pixels
  let running = false, rafId = 0, lastT = 0;
  let vt = 0, spawnDebt = 0, intensity = 0;
  let pointerX = 0, pointerY = 0, sinceMove = 99;
  let seedX = 0, seedY = 0;
  let styles = [];
  const d3 = [0, 0, 0], o2 = [0, 0];

  // Particles are pooled, and each trail is a fixed-size ring buffer, so a
  // frame allocates nothing and never shifts arrays.
  let live = [];
  const pool = [];
  function makeParticle() {
    return { s: new Float64Array(3), xs: new Float32Array(TRAIL), ys: new Float32Array(TRAIL), head: -1, len: 0, age: 0, phase: 0 };
  }

  function attr() { return ATTRACTORS[current]; }

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const wisp = (cs.getPropertyValue("--wisp") || "199,189,226").trim();
    const peak = parseFloat(cs.getPropertyValue("--wisp-alpha")) || 0.5;
    styles = [];
    for (let i = 0; i <= ALPHA_STEPS; i++) {
      styles.push(`rgba(${wisp},${((peak * i) / ALPHA_STEPS).toFixed(4)})`);
    }
  }

  // Where the field lives. On narrow screens the text stacks at the top,
  // so the field sits in the empty lower half instead of behind the words.
  const narrowMQ = window.matchMedia("(max-width: 860px)"); // same breakpoint as the CSS mask
  function narrow() { return narrowMQ.matches; }
  function anchorX() { return narrow() ? W * 0.5 : W * 0.66; }
  function anchorY() { return narrow() ? H * 0.68 : H * 0.5; }

  function spawn(px, py) {
    const a = attr();
    const scale = minDim * a.u;
    const p = pool.pop() || makeParticle();
    const jx = px + (Math.random() - 0.5) * JITTER;
    const jy = py + (Math.random() - 0.5) * JITTER;
    a.seed((jx - anchorX()) / scale, (jy - anchorY()) / scale, p.s);
    p.head = -1; p.len = 0; p.age = 0; p.phase = TICK;
    live.push(p);
    if (live.length > MAX_PARTICLES) pool.push(live.shift());
  }

  function integrate(a, s, dt) {
    const total = a.rate * dt;
    const n = Math.max(1, Math.min(6, Math.ceil(total / a.cap)));
    const h = total / n;
    for (let i = 0; i < n; i++) {
      a.f(s[0], s[1], s[2], d3);
      s[0] += d3[0] * h;
      s[1] += d3[1] * h;
      s[2] += d3[2] * h;
    }
  }

  function frame(t) {
    const dt = Math.min(Math.max(0, (t - lastT) / 1000) || 0.016, 0.05);
    lastT = t;
    sinceMove += dt;
    vt += dt;
    intensity += (1 - intensity) * Math.min(dt * 2.5, 1);

    // Target: the pointer while it is active, otherwise a virtual cursor
    // sweeping a Lissajous path around the anchor (the same path shape as
    // the br1.me hero). The seed point eases towards the target.
    const pointerOn = sinceMove < POINTER_HOLD;
    let tx, ty;
    if (pointerOn) {
      tx = pointerX; ty = pointerY;
    } else {
      tx = anchorX() + Math.cos(vt * 0.9) * minDim * 0.21;
      ty = anchorY() + Math.sin(vt * 1.3) * minDim * 0.19;
    }
    const follow = 1 - Math.exp(-dt * (pointerOn ? 18 : 2.5));
    seedX += (tx - seedX) * follow;
    seedY += (ty - seedY) * follow;

    spawnDebt += SPAWN_RATE * dt;
    while (spawnDebt >= 1) { spawn(seedX, seedY); spawnDebt -= 1; }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1.1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const a = attr();
    const scale = minDim * a.u;
    const cx = anchorX(), cy = anchorY();
    const margin = 20;
    const fadeK = ALPHA_STEPS * intensity;

    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.age += dt;

      // Advance in steps that land exactly on each TICK boundary and record a
      // trail point there, so points are evenly spaced in time: a slow frame
      // lays down several points instead of one long straight segment.
      let left = dt, dead = false;
      while (p.phase + left >= TICK) {
        const step = TICK - p.phase;
        integrate(a, p.s, step);
        left -= step;
        p.phase = 0;
        a.proj(p.s, o2);
        const x = cx + o2[0] * scale, y = cy + o2[1] * scale;
        if (!(x > -margin && x < W + margin && y > -margin && y < H + margin)) { dead = true; break; }
        p.head = (p.head + 1) % TRAIL;
        p.xs[p.head] = x;
        p.ys[p.head] = y;
        if (p.len < TRAIL) p.len++;
      }
      if (!dead) {
        integrate(a, p.s, left);
        p.phase += left;
      }

      const ease = Math.exp(-p.age * FADE);
      if (dead || ease < 0.02) {
        pool.push(p);
        live[i] = live[live.length - 1];
        live.pop();
        continue;
      }
      if (p.len < 1) continue;
      const level = Math.round(ease * fadeK);
      if (level < 1) continue;

      // recorded points, oldest first, then the exact current head
      a.proj(p.s, o2);
      ctx.strokeStyle = styles[level];
      ctx.beginPath();
      let k = (p.head - p.len + 1 + TRAIL) % TRAIL;
      ctx.moveTo(p.xs[k], p.ys[k]);
      for (let j = 1; j < p.len; j++) {
        k = (k + 1) % TRAIL;
        ctx.lineTo(p.xs[k], p.ys[k]);
      }
      ctx.lineTo(cx + o2[0] * scale, cy + o2[1] * scale);
      ctx.stroke();
    }

    if (running) rafId = requestAnimationFrame(frame);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    // The canvas spans the whole hero, so painting it is the real cost, not the
    // maths. Cap the backing store at a pixel budget: phones keep 2x, a large
    // laptop screen drops to about 1.25x, where thin translucent lines look the same.
    const budget = Math.sqrt(PIXEL_BUDGET / Math.max(1, r.width * r.height));
    DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, budget));
    const w = Math.round(r.width * DPR), h = Math.round(r.height * DPR);
    // Recorded trail points are in the old frame; restart each trail so no
    // streak draws a long line from the old layout to the new one.
    if (r.width !== W || r.height !== H) for (const p of live) p.len = 0;
    W = r.width; H = r.height; minDim = Math.min(W, H);
    // Resizing a canvas clears it and is costly, so only do it when the
    // backing size really changes (phones fire resize as the URL bar moves).
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    readColors();
  }

  function start() {
    if (running) return;
    running = true;
    lastT = performance.now();
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  function switchTo(i) {
    current = (i + ATTRACTORS.length) % ATTRACTORS.length;
    while (live.length) pool.push(live.pop());
    return ATTRACTORS[current].name;
  }

  /* ---------- input ----------
     Pointer events cover mouse and pen. On phones the browser takes over a
     touch as soon as it becomes a scroll, so touch events (passive, they keep
     firing while the page scrolls) steer the field with a finger.          */
  function steer(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    if (clientY >= r.top && clientY <= r.bottom && clientX >= r.left && clientX <= r.right) {
      pointerX = clientX - r.left;
      pointerY = clientY - r.top;
      if (sinceMove >= POINTER_HOLD) { seedX = pointerX; seedY = pointerY; }
      sinceMove = 0;
    }
  }
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "touch") steer(e.clientX, e.clientY);
  }, { passive: true });
  const onTouch = (e) => { const t = e.touches[0]; if (t) steer(t.clientX, t.clientY); };
  window.addEventListener("touchstart", onTouch, { passive: true });
  window.addEventListener("touchmove", onTouch, { passive: true });

  let resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(resize, 120);
  });

  let heroVisible = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop(); else if (heroVisible) start();
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      heroVisible = entries[entries.length - 1].isIntersecting;
      if (heroVisible && !document.hidden) start(); else stop();
    }, { threshold: 0.02 }).observe(canvas);
  }

  document.addEventListener("themechange", readColors);

  /* ---------- public api ---------- */
  window.AttractorField = {
    next: () => switchTo(current + 1),
    prev: () => switchTo(current - 1),
    name: () => ATTRACTORS[current].name,
  };

  /* ---------- boot ----------
     The field animates even when the system asks for reduced motion: it is
     a slow, low-contrast background with no flashing, and a frozen frame read
     as a broken page on phones and work PCs with animations turned off. The
     scroll reveals and smooth scrolling in main.js still respect the setting. */
  resize();
  seedX = anchorX(); seedY = anchorY();
  start();
})();
