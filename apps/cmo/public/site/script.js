// CMO.XYZ — interactions + motion.
// Mobile nav, Lenis smooth scroll, and GSAP/ScrollTrigger entrance
// animations. Signature touch: the mascot (which IS a cursor) tracks the
// real pointer. All motion is guarded by prefers-reduced-motion, and the
// site is fully usable if the animation libraries fail to load.
// Nothing hardcodes an agent name (per DESIGN.md).

// ---- Mascot cursor: the arrow-mascot follows the pointer and blinks on click.
//      A DOM element replaces the native cursor on fine-pointer devices; touch
//      keeps its native behaviour. Uses the official sokosumi cursor artwork. ----
(function () {
  if (!(window.matchMedia && matchMedia("(pointer: fine)").matches)) return;

  var SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="165.5 84 486 486">' +
      '<defs><path id="c3dp" d="M310 132 290 507 372 427 417 522 470 500 440 405 527 400Z" stroke-linejoin="round"/></defs>' +
      '<use href="#c3dp" fill="#0a0a0a" stroke="#0a0a0a" stroke-width="96"/>' +
      '<use href="#c3dp" fill="#fff" stroke="#fff" stroke-width="6"/>' +
      '<g class="c3d-eyes-open">' +
        '<ellipse cx="345" cy="305" rx="17" ry="33" fill="#0a0a0a"/>' +
        '<ellipse cx="395" cy="297" rx="17" ry="33" fill="#0a0a0a"/>' +
      '</g>' +
      '<g class="c3d-eyes-closed">' +
        '<rect x="326" y="300" width="38" height="10" rx="5" fill="#0a0a0a"/>' +
        '<rect x="376" y="292" width="38" height="10" rx="5" fill="#0a0a0a"/>' +
      '</g>' +
    '</svg>';

  function init() {
    var root = document.documentElement;
    var el = document.createElement("div");
    el.className = "cursor3d";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = SVG + '<span class="cursor3d__hint">Click</span>';
    document.body.appendChild(el);
    root.classList.add("cursor3d-on"); // now safe to hide the native cursor

    // Show a "Click" hint whenever the pointer is over something clickable.
    var clickable = 'a, button, [role="button"], .btn, .tab, label, summary, select, input[type="submit"]';

    // Arrow tip (hotspot) within the 50x50 element.
    var tipX = 13.3, tipY = 1;
    var x = window.innerWidth / 2, y = window.innerHeight / 2, shown = false;
    function place() {
      el.style.transform = "translate3d(" + (x - tipX) + "px," + (y - tipY) + "px,0)";
    }
    place();

    window.addEventListener("pointermove", function (e) {
      x = e.clientX; y = e.clientY;
      place();
      if (!shown) { shown = true; el.classList.add("is-visible"); }
      var over = e.target && e.target.closest && e.target.closest(clickable);
      el.classList.toggle("is-hover", !!over);
    }, { passive: true });

    // Blink the eyes while the button is pressed (a quick blink on click).
    var blinkTimer = null;
    window.addEventListener("pointerdown", function () {
      if (blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
      el.classList.add("is-blink");
    });
    window.addEventListener("pointerup", function () {
      if (blinkTimer) clearTimeout(blinkTimer);
      blinkTimer = setTimeout(function () { el.classList.remove("is-blink"); }, 130);
    });

    // Hide when the pointer leaves the window; restore on return.
    document.addEventListener("mouseleave", function () { el.classList.remove("is-visible"); });
    document.addEventListener("mouseenter", function () { if (shown) el.classList.add("is-visible"); });
  }

  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init);
})();

// ---- 3D mascot: dismiss poster on load + respect reduced motion ----
(function () {
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("model-viewer").forEach(function (mv) {
    if (reduced) { mv.removeAttribute("auto-rotate"); mv.setAttribute("animation-name", "Blink"); }
    // As soon as the 3D is ready, reveal it so the poster image never lingers.
    var reveal = function () { try { mv.dismissPoster(); } catch (e) {} };
    if (mv.loaded) reveal();
    else mv.addEventListener("load", reveal, { once: true });
  });
})();

// ---- Waitlist capture (self-contained) ----
// Set window.WAITLIST_ENDPOINT (or data-endpoint on the form) to POST emails
// to a real backend (Formspree/Vercel/etc.). With no endpoint it validates
// and shows a success state only (demo); it does not deliver anywhere.
(function () {
  var forms = [].slice.call(document.querySelectorAll("[data-waitlist]"));
  if (!forms.length) return;
  var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  forms.forEach(function (form) {
    var input = form.querySelector('input[type="email"]');
    var urlInput = form.querySelector('input[name="website"]');
    var msg = form.parentNode.querySelector("[data-waitlist-msg]");

    // Reveal the optional website field once the visitor starts typing an email;
    // keep it open while the website field has content or focus.
    function syncExpanded() {
      if (!urlInput) return;
      var open =
        input.value.trim().length > 0 ||
        urlInput.value.trim().length > 0 ||
        document.activeElement === urlInput;
      form.classList.toggle("is-expanded", open);
    }
    if (urlInput && input) {
      input.addEventListener("input", syncExpanded);
      urlInput.addEventListener("input", syncExpanded);
      urlInput.addEventListener("focus", syncExpanded);
      urlInput.addEventListener("blur", syncExpanded);
    }
    function setMsg(text, kind) {
      if (!msg) return;
      msg.textContent = text;
      msg.classList.remove("is-ok", "is-err");
      if (kind) msg.classList.add(kind);
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = (input.value || "").trim();
      if (!re.test(email)) {
        input.setAttribute("aria-invalid", "true");
        setMsg("Please enter a valid email.", "is-err");
        input.focus();
        return;
      }
      input.removeAttribute("aria-invalid");
      var website = urlInput ? (urlInput.value || "").trim() : ""; // optional
      var endpoint = form.getAttribute("data-endpoint") || window.WAITLIST_ENDPOINT;
      function ok() {
        form.reset();
        form.classList.remove("is-expanded");
        setMsg("You're on the list. We'll be in touch.", "is-ok");
        document.dispatchEvent(new CustomEvent("waitlist:joined"));
        if (window.gtag) gtag("event", "sign_up", { method: "waitlist" });
      }
      if (!endpoint) { ok(); return; } // demo mode, no backend wired
      setMsg("Adding you...", null);
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: email, website: website }),
      })
        .then(function (r) {
          if (r.ok) { ok(); return; }
          return r.json().then(
            function (j) { setMsg((j && j.error) || "Something went wrong. Try again.", "is-err"); },
            function () { setMsg("Something went wrong. Try again.", "is-err"); }
          );
        })
        .catch(function () { setMsg("Something went wrong. Try again.", "is-err"); });
    });
  });
})();

// ---- Theme toggle (self-contained; independent of the animation libs) ----
(function () {
  var root = document.documentElement;
  var toggles = [].slice.call(document.querySelectorAll("[data-theme-toggle]"));
  if (!toggles.length) return;

  function currentTheme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }
  function sync() {
    var t = currentTheme();
    toggles.forEach(function (b) {
      b.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
      b.setAttribute("aria-pressed", String(t === "dark"));
      var label = b.querySelector(".theme-toggle__label");
      if (label) label.textContent = t === "dark" ? "Dark" : "Light";
    });
    // Keep the browser UI bar color in step with the active theme.
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", t === "dark" ? "#0a0b0e" : "#f4f6f7");
  }
  function setTheme(t) {
    root.setAttribute("data-theme", t);
    try { localStorage.setItem("theme", t); } catch (e) {}
    sync();
  }
  toggles.forEach(function (b) {
    b.addEventListener("click", function () {
      setTheme(currentTheme() === "dark" ? "light" : "dark");
    });
  });
  // Keep following the system live until the visitor makes a manual choice.
  if (window.matchMedia) {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
      var saved;
      try { saved = localStorage.getItem("theme"); } catch (_) {}
      if (!saved) { root.setAttribute("data-theme", e.matches ? "dark" : "light"); sync(); }
    });
  }
  sync();
})();

(function () {
  "use strict";
  var root = document.documentElement;

  // ---- Mobile nav ----
  var nav = document.querySelector(".nav");
  var toggle = document.querySelector(".nav__toggle");
  if (nav && toggle) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  var reduced =
    window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // No-animation path: guarantee everything is visible, then stop.
  if (reduced || !window.gsap) {
    root.classList.remove("has-anim");
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  // ---- Smooth scroll (Lenis) driven by the GSAP ticker ----
  var lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
    gsap.ticker.lagSmoothing(0);
  }

  // Smooth in-page navigation.
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href");
      if (id.length < 2) return;
      var target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      if (nav) nav.classList.remove("is-open");
      if (lenis) lenis.scrollTo(target, { offset: -70 });
      else target.scrollIntoView({ behavior: "smooth" });
    });
  });

  // ---- Intro: no loading splash. Reveal the hero as soon as the DOM is
  //      ready; the 3D mascot fades into place on its own once loaded. ----
  var model = document.querySelector(".hero__visual model-viewer");
  var visual = document.querySelector(".hero__visual");

  // ---- Baked animation clips (Idle / Hello / Hop / Blink / Spin) ----
  function clipList() { return (model && model.availableAnimations) || []; }
  function hasClip(n) { return clipList().indexOf(n) !== -1; }
  // Resting state: a gentle sway with blinks. Every few seconds Cuso hops or
  // waves on his own; clicking him (or joining the waitlist) makes him spin.
  var busy = false;
  var actTimer = null;
  var heroVisible = true;
  function loopIdle() {
    if (!hasClip("Idle")) return;
    busy = false;
    model.animationName = "Idle";
    model.play();
  }
  function act(name, force) {
    if (!hasClip(name) || (busy && !force)) return;
    busy = true;
    model.animationName = name;
    // Switching clips restarts them looping on the next render; play once after that.
    model.updateComplete.then(function () { model.play({ repetitions: 1 }); });
  }
  function scheduleActs() {
    clearTimeout(actTimer);
    actTimer = setTimeout(function () {
      if (heroVisible && !document.hidden) act(Math.random() < 0.6 ? "Hop" : "Hello");
      scheduleActs();
    }, 6000 + Math.random() * 5000);
  }
  if (model) {
    model.addEventListener("finished", loopIdle);
    model.addEventListener("click", function () { act("Spin", true); });
    document.addEventListener("waitlist:joined", function () { act("Spin", true); });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        heroVisible = entries[0].isIntersecting;
      }).observe(model);
    }
  }
  function startMascotMotion() {
    gsap.to(".hero .orb", { scale: 1.08, opacity: 0.85, duration: 3.2, ease: "sine.inOut", repeat: -1, yoyo: true });
    if (!model) return;

    // Static pose — no bobbing or spinning. The mascot simply turns to watch
    // the cursor, as if looking at it. When the pointer is still, it holds.
    model.removeAttribute("auto-rotate");
    model.removeAttribute("camera-controls");
    model.setAttribute("interpolation-decay", "0");
    var fine = matchMedia("(pointer:fine)").matches;
    var tTheta = 0, tPhi = 82, cTheta = 0, cPhi = 82;
    if (fine) {
      window.addEventListener("pointermove", function (e) {
        var dx = e.clientX / window.innerWidth - 0.5;
        var dy = e.clientY / window.innerHeight - 0.5;
        tTheta = dx * 60; tPhi = 82 - dy * 26;
      });
    }
    (function loop() {
      cTheta += (tTheta - cTheta) * 0.1;
      cPhi += (tPhi - cPhi) * 0.1;
      model.setAttribute("camera-orbit", cTheta.toFixed(2) + "deg " + cPhi.toFixed(2) + "deg 95%");
      requestAnimationFrame(loop);
    })();

    act("Hello", true); // wave when he lands
    scheduleActs();
  }

  function revealText() {
    gsap.set(".nav", { y: -18, autoAlpha: 0 });
    gsap
      .timeline({ defaults: { ease: "power3.out", duration: 0.9 } })
      .from(".hero .pill", { y: 18, autoAlpha: 0, duration: 0.6 })
      .from(".hero h1", { y: 30, autoAlpha: 0 }, "-=0.35")
      .from(".hero .lead", { y: 22, autoAlpha: 0 }, "-=0.6")
      .from(".hero .waitlist", { y: 20, autoAlpha: 0 }, "-=0.65")
      .from(".hero__meta", { y: 16, autoAlpha: 0 }, "-=0.7")
      .to(".nav", { y: 0, autoAlpha: 1, duration: 0.7 });
  }

  var introDone = false;
  var motionStarted = false;
  function startMotionOnce() {
    if (motionStarted) return;
    motionStarted = true;
    startMascotMotion();
  }
  // Snap the mascot + hero straight to their resting state (no fly-in).
  function settleMascot() {
    if (model) gsap.set(model, { x: 0, y: 0, scale: 1, autoAlpha: 1 });
    root.classList.remove("has-anim");
    gsap.set(".nav, .hero__text > *", { clearProps: "opacity,visibility,transform" });
    loopIdle();
    startMotionOnce();
  }

  // Entrance: the mascot fades in large and centered on screen, holds a beat,
  // then glides smoothly down into its hero slot while the text rises in.
  // The fly-in uses viewport-relative positioning, so it only plays from the
  // very top; if the visitor scrolls during it, we snap straight to the rest
  // state so the mascot never floats into the section below.
  function enterMascot() {
    if (introDone) return;
    introDone = true;

    gsap.set(visual, { autoAlpha: 1 }); // show the mascot layer (text stays hidden)

    // Already scrolled (restored position / quick scroll): skip the fly-in.
    if (window.scrollY > 40) { settleMascot(); return; }

    // FLIP: measure the final slot, then start big + centered on screen.
    // Scale is capped to the viewport so the mascot is never clipped on phones.
    var hr = model.getBoundingClientRect();
    var dx = window.innerWidth / 2 - (hr.left + hr.width / 2);
    var dy = window.innerHeight * 0.5 - (hr.top + hr.height / 2);
    var scale = Math.min(1.5, (window.innerWidth * 0.95) / hr.width, (window.innerHeight * 0.95) / hr.height);
    if (!isFinite(scale) || scale < 1) scale = 1;
    gsap.set(model, { x: dx, y: dy, scale: scale, autoAlpha: 0, transformOrigin: "center center" });
    loopIdle(); // blink while it arrives

    var tl = gsap.timeline({ defaults: { ease: "power3.inOut" } })
      .to(model, { autoAlpha: 1, duration: 0.6, ease: "power2.out" })          // fade in, centered
      .to(model, { x: 0, y: 0, scale: 1, duration: 1.3 }, "+=0.5")             // hold, then glide home
      .add(function () { root.classList.remove("has-anim"); revealText(); }, "<0.1") // text rises with it
      .add(startMotionOnce);                                                   // cursor-follow on arrival

    // If the visitor scrolls while the fly-in is running, finish it instantly.
    function onScroll() {
      if (window.scrollY <= 6) return;        // ignore tiny/spurious scrolls at top
      window.removeEventListener("scroll", onScroll);
      if (tl.isActive()) { tl.kill(); settleMascot(); }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    tl.eventCallback("onComplete", function () { window.removeEventListener("scroll", onScroll); });
  }

  // Fallback: no model, or it never loads — just reveal everything in place.
  function revealPlain() {
    if (introDone) return;
    introDone = true;
    root.classList.remove("has-anim");
    if (visual) gsap.set(visual, { clearProps: "opacity,visibility" });
    revealText();
    loopIdle();
    startMascotMotion();
  }

  function runIntro() {
    if (!model) { revealPlain(); return; }
    if (model.loaded) { enterMascot(); return; }
    var done = false;
    model.addEventListener("load", function () { if (done) return; done = true; enterMascot(); }, { once: true });
    setTimeout(function () { if (done) return; done = true; revealPlain(); }, 2500); // safety if load stalls
  }

  if (document.readyState !== "loading") runIntro();
  else document.addEventListener("DOMContentLoaded", runIntro);

  // ---- Cursor companion: the mascot trails the real pointer ----
  var pet = document.querySelector(".cursor-pet");
  if (pet && matchMedia("(pointer:fine)").matches) {
    gsap.set(pet, { xPercent: -50, yPercent: -50 });
    var petX = gsap.quickTo(pet, "x", { duration: 0.5, ease: "power3.out" });
    var petY = gsap.quickTo(pet, "y", { duration: 0.5, ease: "power3.out" });
    var petR = gsap.quickTo(pet, "rotation", { duration: 0.4, ease: "power2.out" });
    var prevX = null, shown = false;
    window.addEventListener("pointermove", function (e) {
      petX(e.clientX);
      petY(e.clientY);
      if (prevX !== null) {
        var lean = (e.clientX - prevX) * 1.4;
        petR(Math.max(-20, Math.min(20, lean)));
      }
      prevX = e.clientX;
      if (!shown) {
        shown = true;
        gsap.to(pet, { autoAlpha: 1, duration: 0.4 });
      }
    });
    // Grow when hovering interactive things.
    document.querySelectorAll("a, button, .avatars li, .feat").forEach(function (el) {
      el.addEventListener("mouseenter", function () {
        gsap.to(pet, { scale: 1.6, duration: 0.3, ease: "back.out(2)" });
      });
      el.addEventListener("mouseleave", function () {
        gsap.to(pet, { scale: 1, duration: 0.3, ease: "power2.out" });
      });
    });
  }

  // ---- Section heads ----
  gsap.utils.toArray(".section__head").forEach(function (el) {
    gsap.from(el.children, {
      y: 24, autoAlpha: 0, duration: 0.8, stagger: 0.08, ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 82%" },
    });
  });

  // ---- Channels ----
  gsap.from(".channels-sec__label", {
    y: 10, autoAlpha: 0, duration: 0.6,
    scrollTrigger: { trigger: ".channels-sec", start: "top 88%" },
  });
  gsap.from(".channel", {
    y: 16, autoAlpha: 0, duration: 0.5, stagger: 0.06, ease: "power3.out",
    scrollTrigger: { trigger: ".channels-sec", start: "top 86%" },
  });

  // ---- Chat mockup: messages arrive in sequence ----
  gsap
    .timeline({ scrollTrigger: { trigger: ".chat", start: "top 74%" } })
    .from(".chat", { y: 34, autoAlpha: 0, duration: 0.8, ease: "power3.out" })
    .from(".chat__input", { y: 12, autoAlpha: 0, duration: 0.5 }, "-=0.3");

  // ---- Statement ----
  gsap.from(".statement .eyebrow, .statement__grid > *", {
    y: 24, autoAlpha: 0, duration: 0.8, stagger: 0.08, ease: "power3.out",
    scrollTrigger: { trigger: ".statement", start: "top 85%" },
  });

  // ---- Capabilities tabs reveal ----
  gsap.from(".tabs__list .tab", {
    y: 18, autoAlpha: 0, duration: 0.6, stagger: 0.07, ease: "power3.out",
    scrollTrigger: { trigger: ".tabs", start: "top 84%" },
  });
  gsap.from(".tabs__panels", {
    y: 24, autoAlpha: 0, duration: 0.8, ease: "power3.out",
    scrollTrigger: { trigger: ".tabs", start: "top 84%" },
  });

  // ---- Steps ----
  gsap.from(".step", {
    y: 28, autoAlpha: 0, duration: 0.7, stagger: 0.14, ease: "power3.out",
    scrollTrigger: { trigger: ".steps", start: "top 82%" },
  });
  gsap.from(".step__icon", {
    scale: 0.6, autoAlpha: 0, duration: 0.5, stagger: 0.14, ease: "back.out(2)",
    scrollTrigger: { trigger: ".steps", start: "top 82%" },
  });

  // ---- Your agent ----
  gsap.from(".split__text > *", {
    y: 22, autoAlpha: 0, duration: 0.7, stagger: 0.1,
    scrollTrigger: { trigger: ".section--split", start: "top 80%" },
  });
  gsap.from(".avatars li", {
    y: 22, scale: 0.9, autoAlpha: 0, duration: 0.6, stagger: 0.08, ease: "back.out(1.5)",
    scrollTrigger: { trigger: ".avatars", start: "top 85%" },
  });

  // ---- Who ----
  gsap.from(".who > div", {
    y: 22, autoAlpha: 0, duration: 0.7, stagger: 0.1,
    scrollTrigger: { trigger: ".who", start: "top 84%" },
  });

  // ---- CTA ----
  gsap.from(".cta__art", {
    scale: 0.8, autoAlpha: 0, duration: 0.8, ease: "back.out(1.5)",
    scrollTrigger: { trigger: ".cta", start: "top 80%" },
  });
  gsap.from(".cta h2, .cta p, .cta .waitlist, .cta__fine", {
    y: 22, autoAlpha: 0, duration: 0.7, stagger: 0.1,
    scrollTrigger: { trigger: ".cta", start: "top 78%" },
  });
  gsap.to(".cta .orb--sm", { scale: 1.1, opacity: 0.85, duration: 3.2, ease: "sine.inOut", repeat: -1, yoyo: true });

  // Recalculate once fonts and images have settled.
  window.addEventListener("load", function () { ScrollTrigger.refresh(); });
})();


// ---- Chat player: live-texting feel, the mascot "solving" ----
(function () {
  var body = document.querySelector("[data-chat]");
  if (!body) return;
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !("IntersectionObserver" in window)) return; // leave static for reduced motion
  if (!window.gsap) return; // needs GSAP for smooth playback
  var msgs = [].slice.call(body.querySelectorAll(".msg"));
  gsap.set(msgs, { display: "none" });
  var played = false;

  function typingBubble(src) {
    var w = document.createElement("div");
    w.className = "msg msg--agent msg--typing";
    w.innerHTML = '<img src="' + src + '" alt="" /><p class="typing"><span></span><span></span><span></span></p>';
    return w;
  }
  function reveal(el) {
    body.appendChild(el);
    gsap.fromTo(el, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out" });
  }
  function play() {
    if (played) return;
    played = true;
    var i = 0;
    (function step() {
      if (i >= msgs.length) return;
      var m = msgs[i];
      if (m.classList.contains("msg--agent")) {
        var img = m.querySelector("img");
        var t = typingBubble(img ? img.getAttribute("src") : "");
        reveal(t);
        gsap.delayedCall(parseInt(m.getAttribute("data-typing") || "1200", 10) / 1000, function () {
          gsap.to(t, {
            autoAlpha: 0, duration: 0.25,
            onComplete: function () {
              if (t.parentNode) t.parentNode.removeChild(t);
              m.style.display = "";
              reveal(m);
              i++;
              gsap.delayedCall(0.5, step);
            },
          });
        });
      } else {
        m.style.display = "";
        reveal(m);
        i++;
        gsap.delayedCall(0.75, step);
      }
    })();
  }
  new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) play(); });
  }, { threshold: 0.35 }).observe(body);
})();

// ---- Pricing: monthly / yearly billing toggle (self-contained) ----
(function () {
  var group = document.querySelector("[data-bill]");
  if (!group) return;
  var opts = [].slice.call(group.querySelectorAll("[data-bill-opt]"));
  var amounts = [].slice.call(document.querySelectorAll(".tier__amount"));
  var notes = [].slice.call(document.querySelectorAll("[data-bill-note]"));
  function set(period) {
    var yearly = period === "yearly";
    opts.forEach(function (o) {
      var on = o.getAttribute("data-bill-opt") === period;
      o.classList.toggle("is-active", on);
      o.setAttribute("aria-pressed", String(on));
    });
    amounts.forEach(function (a) {
      var v = a.getAttribute(yearly ? "data-y" : "data-m");
      if (v) a.textContent = "$" + v;
    });
    notes.forEach(function (n) { n.hidden = !yearly; });
  }
  opts.forEach(function (o) {
    o.addEventListener("click", function () { set(o.getAttribute("data-bill-opt")); });
  });
})();

// ---- Capabilities tabs (self-contained; works even without GSAP) ----
(function () {
  var root = document.querySelector(".tabs");
  if (!root) return;
  var tabs = [].slice.call(root.querySelectorAll(".tab"));
  var panels = [].slice.call(root.querySelectorAll(".panel"));
  if (!tabs.length) return;

  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DURATION = 5200;
  var current = 0, timer = null, barTween = null;

  function resetBars() {
    if (barTween) { barTween.kill(); barTween = null; }
    tabs.forEach(function (t) {
      var b = t.querySelector(".tab__bar");
      if (!b) return;
      if (window.gsap) gsap.set(b, { scaleX: 0 });
      else b.style.transform = "scaleX(0)";
    });
  }

  function runBar() {
    if (reduced || !window.gsap) return;
    var bar = tabs[current].querySelector(".tab__bar");
    if (bar) barTween = gsap.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: DURATION / 1000, ease: "none" });
  }

  function activate(i) {
    current = i;
    tabs.forEach(function (t, idx) {
      var on = idx === i;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panels.forEach(function (p, idx) {
      var on = idx === i;
      p.classList.toggle("is-active", on);
      p.hidden = !on;
    });
    resetBars();
  }

  function next() { activate((current + 1) % tabs.length); runBar(); }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (barTween) barTween.pause();
  }
  function start() {
    if (reduced) return;
    stop();
    runBar();
    timer = setInterval(next, DURATION);
  }

  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { activate(i); start(); });
    t.addEventListener("keydown", function (e) {
      var k = e.key;
      if (k === "ArrowDown" || k === "ArrowRight") {
        e.preventDefault(); activate((i + 1) % tabs.length); tabs[current].focus(); start();
      } else if (k === "ArrowUp" || k === "ArrowLeft") {
        e.preventDefault(); activate((i - 1 + tabs.length) % tabs.length); tabs[current].focus(); start();
      }
    });
  });

  root.addEventListener("mouseenter", stop);
  root.addEventListener("mouseleave", start);

  activate(0);

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) start(); else stop(); });
    }, { threshold: 0.3 }).observe(root);
  } else {
    start();
  }
})();
