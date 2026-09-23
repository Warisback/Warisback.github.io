/* Theme toggle, attractor switcher, scroll reveals, thumbnail tilt. */

(function () {
  "use strict";

  const root = document.documentElement;
  root.classList.add("js");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- theme ---------- */
  const toggle = document.getElementById("theme-toggle");

  function storedTheme() {
    try { return localStorage.getItem("theme"); } catch (_) { return null; }
  }
  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    if (toggle) toggle.textContent = theme === "dark" ? "Light" : "Dark";
    document.dispatchEvent(new Event("themechange"));
  }

  const urlTheme = new URLSearchParams(location.search).get("theme");
  const saved = urlTheme === "light" || urlTheme === "dark" ? urlTheme : storedTheme();
  if (saved === "light" || saved === "dark") applyTheme(saved);
  else if (toggle) toggle.textContent = "Light"; // default dark

  if (toggle) {
    toggle.addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem("theme", next); } catch (_) {}
    });
  }

  /* ---------- attractor switcher ---------- */
  const nameEl = document.getElementById("attr-name");
  let nameT;
  function showName(name) {
    if (!nameEl) return;
    nameEl.textContent = name;
    nameEl.classList.add("show");
    clearTimeout(nameT);
    nameT = setTimeout(() => nameEl.classList.remove("show"), 3500);
  }
  const prevBtn = document.getElementById("attr-prev");
  const nextBtn = document.getElementById("attr-next");
  if (window.AttractorField) {
    if (prevBtn) prevBtn.addEventListener("click", () => showName(window.AttractorField.prev()));
    if (nextBtn) nextBtn.addEventListener("click", () => showName(window.AttractorField.next()));
    // introduce the current attractor once, shortly after load
    setTimeout(() => showName(window.AttractorField.name()), 1400);
  }

  /* ---------- scroll reveals ---------- */
  const revealed = document.querySelectorAll(".reveal");
  const staticMode = new URLSearchParams(location.search).has("static");
  if (staticMode) {
    root.classList.add("static");
    revealed.forEach((el) => el.classList.add("visible"));
  } else if ("IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          io.unobserve(e.target);
        }
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    revealed.forEach((el) => io.observe(el));
  } else {
    revealed.forEach((el) => el.classList.add("visible"));
  }

  /* ---------- thumbnail tilt ---------- */
  if (!reduceMotion && window.matchMedia("(hover: hover)").matches) {
    document.querySelectorAll(".thumb").forEach((thumb) => {
      let raf = 0;
      thumb.addEventListener("pointermove", (e) => {
        const r = thumb.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          thumb.style.transform =
            `perspective(900px) rotateY(${px * 5}deg) rotateX(${-py * 5}deg)`;
        });
      });
      thumb.addEventListener("pointerleave", () => {
        cancelAnimationFrame(raf);
        thumb.style.transform = "";
      });
    });
  }

  /* ---------- smooth in-page scrolling (respects reduced motion) ---------- */
  document.querySelectorAll("[data-scroll]").forEach((a) => {
    a.addEventListener("click", (e) => {
      const target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
      history.replaceState(null, "", a.getAttribute("href"));
    });
  });
})();
