/* ============================================================
   Strange-attractor wisps.
   Short particle trails advected through a 3D chaotic system.
   The canvas is cleared and every trail redrawn each frame, so
   nothing ever accumulates: each streak eases in, ages, and
   exponentially fades away. New particles are seeded from the
   cursor while it moves; a slow wandering point keeps the field
   alive when it doesn't.
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
      seed: (dx, dy) => [dx, dx, dy + 25],
      f: (x, y, z, d) => {
        d[0] = 10 * (y - x);
        d[1] = x * (28 - z) - y;
        d[2] = x * y - (8 / 3) * z;
      },
      proj: (s, o) => { o[0] = s[0]; o[1] = s[2] - 25; },
    },
    {
      name: "Thomas", u: 1 / 8.5, rate: 3.0, cap: 0.05,
      seed: (dx, dy) => [dx, dy, (dx - dy) / 2],
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
      seed: (dx, dy) => [dx, 0.2, dy + 0.55],
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
      seed: (dx, dy) => [dx - 2, dy - 2, -2],
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
      seed: (dx, dy) => [dx, dy * 0.8, 0],
      f: (x, y, z, d) => {
        d[0] = y - 3 * x + 2.7 * y * z;
        d[1] = 1.7 * y - x * z + z;
        d[2] = 2 * x * y - 9 * z;
      },
      proj: (s, o) => { o[0] = s[0]; o[1] = s[2]; },
    },
  ];

  /* ---------- tuning ---------- */
  const TRAIL = 40;         // points kept per streak
  const FADE = 0.95;        // exponential age fade
  const MAX_PARTICLES = 900;
  const SPAWN_CURSOR = 3;   // per frame while the pointer moves
  const SPAWN_AMBIENT = 3;  // per frame from the wandering point
  const CURSOR_HOLD = 1.4;  // s of cursor spawning after the last move

  /* ---------- state ---------- */
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let current = 0;
  let particles = [];
  let W = 0, H = 0, DPR = 1, minDim = 0;
  let running = false, rafId = 0, lastT = 0, elapsed = 0;
  let mouseX = 0, mouseY = 0, sinceMove = 99;
  let wisp = "199,189,226", baseAlpha = 0.48;
  const d3 = [0, 0, 0], o2 = [0, 0];

  function attr() { return ATTRACTORS[current]; }

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    wisp = (cs.getPropertyValue("--wisp") || "199,189,226").trim();
    baseAlpha = parseFloat(cs.getPropertyValue("--wisp-alpha")) || 0.48;
  }

  // ambient anchor: where the field lives when the cursor is idle
  function anchorX() { return W < 860 * DPR ? W * 0.5 : W * 0.66; }
  function anchorY() { return H * 0.5; }

  // slow lissajous wander around the anchor
  function wanderPoint(out) {
    const r = minDim * 0.22;
    out[0] = anchorX() + Math.sin(elapsed * 0.21) * r * 1.25;
    out[1] = anchorY() + Math.sin(elapsed * 0.157 + 1.7) * r;
  }
  const wp = [0, 0];

  function spawn(px, py, jitter) {
    const a = attr();
    const jx = px + (Math.random() - 0.5) * jitter;
    const jy = py + (Math.random() - 0.5) * jitter;
    const scale = minDim * a.u;
    const s = a.seed((jx - anchorX()) / scale, (jy - anchorY()) / scale);
    particles.push({ s, pts: [], age: 0 });
    if (particles.length > MAX_PARTICLES) particles.shift();
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
    const dt = Math.min((t - lastT) / 1000 || 0.016, 0.033);
    lastT = t;
    elapsed += dt;
    sinceMove += dt;

    ctx.clearRect(0, 0, W, H);

    // seed new streaks
    if (sinceMove < CURSOR_HOLD) {
      for (let i = 0; i < SPAWN_CURSOR; i++) spawn(mouseX, mouseY, 8 * DPR);
    } else {
      wanderPoint(wp);
      for (let i = 0; i < SPAWN_AMBIENT; i++) {
        if (Math.random() < 0.3) {
          // scatter some seeds across the whole basin so the lobes fill out
          const ang = Math.random() * Math.PI * 2;
          const rad = Math.sqrt(Math.random()) * minDim * 0.3;
          spawn(anchorX() + Math.cos(ang) * rad, anchorY() + Math.sin(ang) * rad, 6 * DPR);
        } else {
          spawn(wp[0], wp[1], 12 * DPR);
        }
      }
    }

    const a = attr();
    const scale = minDim * a.u;
    const cx = anchorX(), cy = anchorY();
    const margin = 24 * DPR;

    ctx.lineWidth = 1.1 * DPR;
    ctx.lineCap = "round";

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      integrate(a, p.s, dt);
      a.proj(p.s, o2);
      const x = cx + o2[0] * scale;
      const y = cy + o2[1] * scale;
      p.age += dt;

      const ease = Math.exp(-p.age * FADE);
      const out = !isFinite(x) || !isFinite(y) ||
        x < -margin || x > W + margin || y < -margin || y > H + margin;
      if (ease < 0.02 || out) { particles.splice(i, 1); continue; }

      p.pts.push(x, y);
      if (p.pts.length > TRAIL * 2) p.pts.splice(0, 2);
      if (p.pts.length < 4) continue;

      ctx.strokeStyle = `rgba(${wisp},${baseAlpha * ease})`;
      ctx.beginPath();
      ctx.moveTo(p.pts[0], p.pts[1]);
      for (let j = 2; j < p.pts.length; j += 2) ctx.lineTo(p.pts[j], p.pts[j + 1]);
      ctx.stroke();
    }

    if (running) rafId = requestAnimationFrame(frame);
  }

  /* one calm non-animated rendering for reduced motion */
  function staticRender() {
    ctx.clearRect(0, 0, W, H);
    const a = attr();
    const scale = minDim * a.u;
    const cx = anchorX(), cy = anchorY();
    const s = a.seed(0.5, 0.5);
    for (let k = 0; k < 300; k++) integrate(a, s, 0.016);
    ctx.strokeStyle = `rgba(${wisp},${baseAlpha * 0.22})`;
    ctx.lineWidth = 1 * DPR;
    ctx.beginPath();
    a.proj(s, o2);
    ctx.moveTo(cx + o2[0] * scale, cy + o2[1] * scale);
    for (let k = 0; k < 20000; k++) {
      integrate(a, s, 0.01);
      a.proj(s, o2);
      ctx.lineTo(cx + o2[0] * scale, cy + o2[1] * scale);
    }
    ctx.stroke();
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.round(r.width * DPR);
    H = Math.round(r.height * DPR);
    canvas.width = W;
    canvas.height = H;
    minDim = Math.min(W, H);
    readColors();
    if (reduceMotion) staticRender();
  }

  function start() {
    if (running || reduceMotion) return;
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
    particles = [];
    ctx.clearRect(0, 0, W, H);
    if (reduceMotion) staticRender();
    return ATTRACTORS[current].name;
  }

  /* ---------- events ---------- */
  window.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    if (e.clientY <= r.bottom && e.clientY >= r.top) {
      mouseX = (e.clientX - r.left) * DPR;
      mouseY = (e.clientY - r.top) * DPR;
      sinceMove = 0;
    }
  }, { passive: true });

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
      heroVisible = entries[0].isIntersecting;
      if (heroVisible && !document.hidden) start(); else stop();
    }, { threshold: 0.02 }).observe(canvas);
  }

  document.addEventListener("themechange", () => {
    readColors();
    if (reduceMotion) staticRender();
  });

  /* ---------- public api ---------- */
  window.AttractorField = {
    next: () => switchTo(current + 1),
    prev: () => switchTo(current - 1),
    name: () => ATTRACTORS[current].name,
  };

  /* ---------- boot ---------- */
  resize();
  if (reduceMotion) staticRender(); else start();
})();
