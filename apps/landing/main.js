const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* Words: each word becomes a span so headlines can animate word by word */
for (const el of $$("[data-words]")) {
  const words = el.textContent.trim().split(/\s+/);
  el.style.setProperty("--n", words.length);
  el.replaceChildren(
    ...words.flatMap((word, i) => {
      const span = document.createElement("span");
      span.dataset.w = "";
      span.style.setProperty("--i", i);
      span.textContent = word;
      return i ? [" ", span] : [span];
    }),
  );
}

/* Tabs: the feature index and the agent list share this */
for (const list of $$('[role="tablist"]')) {
  const tabs = $$('[role="tab"]', list);
  const select = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
    if (!reduced)
      document.getElementById(tab.getAttribute("aria-controls"))._run?.();
  };
  for (const [i, tab] of tabs.entries()) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[
        e.key
      ];
      if (!step) return;
      e.preventDefault();
      const next = tabs[(i + step + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  }
}

/* Demo engine: every demo is an async script that an AbortSignal can stop at any await */
class Stop extends Error {}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Stop());
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => (clearTimeout(timer), reject(new Stop())),
      { once: true },
    );
  });
}

async function type(el, text, signal, speed = 24) {
  el.textContent = "";
  for (const ch of text) {
    el.textContent += ch;
    await sleep(ch === " " ? speed * 1.6 : speed, signal);
  }
}

async function press(el, signal) {
  el.classList.add("is-pressed");
  await sleep(180, signal);
  el.classList.remove("is-pressed");
}

async function playSteps(root, signal, pause = 900) {
  const working = $("[data-working]", root);
  for (const el of $$("[data-step]", root)) {
    if (el.dataset.wait && working) {
      $("[data-working-name]", working).textContent = el.dataset.wait;
      working.hidden = false;
      await sleep(1300, signal);
      working.hidden = true;
    }
    el.classList.remove("off");
    await sleep(pause, signal);
  }
}

const transient = "[data-working],[data-caret]";

function rest(root, done) {
  for (const el of $$(transient, root)) el.hidden = true;
  for (const el of $$(".is-pressed", root)) el.classList.remove("is-pressed");
  for (const el of $$("[data-step]", root)) el.classList.toggle("off", !done);
  for (const el of $$("[data-type]", root)) {
    el._text ??= el.textContent;
    el.textContent = done ? el._text : "";
  }
}

/* Hero */
const SCENES = {
  ask: "Step 1: Lena asks her Soko Bot about competitor pricing.",
  team: "Step 2: the Soko Bot, an AI coworker, a teammate and the team's own agent answer in the launch channel.",
  needs: "Step 3: Home shows one task that needs Lena's decision.",
};

function scene(root, name, say = false) {
  root.dataset.scene = name;
  for (const b of $$("[data-go]", root))
    b.setAttribute("aria-pressed", String(b.dataset.go === name));
  const ask = $('[data-type="ask"]', root);
  ask._text ??= ask.textContent;
  ask.textContent = name === "ask" ? ask._text : "";
  $("[data-needcount]", root).textContent =
    name === "needs" ? "1 task needs your input" : "Nothing needs you";
  if (say) $("[data-scene-live]", root).textContent = SCENES[name];
}

async function hero(root, signal) {
  const ask = $('[data-type="ask"]', root);
  scene(root, "ask");
  ask.textContent = "";
  await sleep(900, signal);
  await type(ask, ask._text, signal);
  await sleep(500, signal);
  await press($(".view--home .send", root), signal);
  scene(root, "team");
  await playSteps($(".view--chat", root), signal);
  await sleep(1400, signal);
  scene(root, "needs");
}

async function catchup(root, signal) {
  const sum = $('[data-type="sum"]', root);
  await sleep(300, signal);
  await type(sum, sum._text, signal, 11);
  await sleep(250, signal);
  await playSteps(root, signal, 380);
}

async function connect(root, signal) {
  const name = $('[data-type="name"]', root);
  const caret = $("[data-caret]", root);
  await sleep(400, signal);
  caret.hidden = false;
  await type(name, name._text, signal, 110);
  await sleep(500, signal);
  caret.hidden = true;
  await press($("[data-press]", root), signal);
  await sleep(250, signal);
  await playSteps(root, signal);
}

/* Task board: FLIP every card so a move never jumps */
const SPRING = getComputedStyle(document.documentElement)
  .getPropertyValue("--ease-bounce")
  .trim();

function flip(board, mutate) {
  const cards = $$(".card", board);
  const before = new Map(cards.map((c) => [c, c.getBoundingClientRect()]));
  mutate();
  for (const col of $$(".col", board))
    $("[data-count]", col).textContent = $$(".card", col).length;
  if (reduced) return;
  for (const card of cards) {
    const a = before.get(card);
    const b = card.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (dx || dy)
      card.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: 520, easing: SPRING },
      );
  }
}

const STATES = {
  ready: ["ink", "Ready"],
  running: ["accent", "Running"],
  input: ["wait", "Waiting on Sam"],
  done: ["ok", "Done"],
};

function setState(card, colName) {
  const state = $("[data-state]", card);
  if (!state) return;
  const [dot, text] = STATES[colName];
  state.firstElementChild.className = `dot dot--${dot}`;
  state.lastElementChild.textContent = text;
}

function moveTo(board, card, colName) {
  flip(board, () => {
    $(`[data-col="${colName}"]`, board).append(card);
    setState(card, colName);
  });
}

function boardHome(root) {
  const board = $(".board", root);
  flip(board, () => {
    for (const card of $$(".card", board))
      card._home[0].insertBefore(card, card._home[1]);
  });
  setState($("[data-hero-card]", board), "running");
}

async function board(root, signal) {
  const el = $(".board", root);
  const card = $("[data-hero-card]", el);
  await sleep(900, signal);
  moveTo(el, card, "input");
  await sleep(2000, signal);
  moveTo(el, card, "done");
}

function draggable(root) {
  const el = $(".board", root);
  const cols = $$(".col", el);
  for (const card of $$(".card", el)) {
    card._home = [card.parentElement, card.nextElementSibling];
    card.setAttribute("aria-roledescription", "task");
    card.setAttribute(
      "aria-label",
      `${$(".card__id", card).textContent}: ${$(".card__id", card).nextElementSibling.textContent}`,
    );
  }
  flip(el, () => {});

  el.addEventListener("pointerdown", (e) => {
    const card = e.target.closest(".card");
    if (!card || e.pointerType === "touch" || e.button) return;
    e.preventDefault();
    root._stop?.(true);
    card.getAnimations().forEach((a) => a.cancel());
    card.setPointerCapture(e.pointerId);
    card.classList.add("is-dragging");
    const x0 = e.clientX;
    const y0 = e.clientY;
    const colAt = (x) =>
      cols.find((c) =>
        ((r) => x >= r.left && x <= r.right)(c.getBoundingClientRect()),
      );

    const move = (ev) => {
      const dx = ev.clientX - x0;
      card.style.transform = `translate(${dx}px, ${ev.clientY - y0}px) rotate(${Math.max(-3, Math.min(3, dx / 50))}deg)`;
      const over = colAt(ev.clientX);
      for (const c of cols) c.classList.toggle("is-over", c === over);
    };
    const drop = (ev) => {
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerup", drop);
      card.removeEventListener("pointercancel", drop);
      const col = colAt(ev.clientX) ?? card.parentElement;
      const after = $$(".card", col).find(
        (c) =>
          c !== card &&
          ((r) => ev.clientY < r.top + r.height / 2)(c.getBoundingClientRect()),
      );
      flip(el, () => {
        card.style.transform = "";
        col.insertBefore(card, after ?? null);
        setState(card, col.dataset.col);
      });
      card.classList.remove("is-dragging");
      for (const c of cols) c.classList.remove("is-over");
    };
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", drop);
    card.addEventListener("pointercancel", drop);
  });

  el.addEventListener("keydown", (e) => {
    const card = e.target.closest(".card");
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    const col = card && step && cols[cols.indexOf(card.parentElement) + step];
    if (!col) return;
    e.preventDefault();
    root._stop?.(true);
    flip(el, () => (col.append(card), setState(card, col.dataset.col)));
    card.focus();
    $("[data-live]", root).textContent =
      `${card.children[card.children.length - 2].textContent} moved to ${$(".col__head", col).childNodes[1].textContent}`;
  });
}

/* Wiring */
const demos = { hero, catchup, connect, board };

for (const a of $$("[data-tab]"))
  a.addEventListener("click", () =>
    document.getElementById(a.dataset.tab).click(),
  );

for (const root of $$("[data-demo]")) {
  const name = root.dataset.demo;
  let ctl;
  if (name === "board") draggable(root);
  if (name === "hero") {
    for (const b of $$("[data-go]", root)) {
      b.addEventListener("click", () => {
        root._stop();
        scene(root, b.dataset.go, true);
      });
    }
    scene(root, root.dataset.scene);
  }

  root._stop = (keep) => {
    ctl?.abort();
    if (!keep) rest(root, true);
  };
  root._run = async () => {
    ctl?.abort();
    const mine = (ctl = new AbortController());
    if (name === "board") boardHome(root);
    rest(root, false);
    try {
      await demos[name](root, mine.signal);
    } catch (e) {
      if (!(e instanceof Stop)) throw e;
    }
  };
  $("[data-replay]", root)?.addEventListener("click", root._run);
  root.addEventListener("pointerdown", (e) => {
    if (!e.target.closest("[data-replay], [data-go], .card")) root._stop();
  });
  if (!reduced && name !== "board") rest(root, false);
}

if (!reduced) {
  const play = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        play.unobserve(e.target);
        e.target._run();
      }
    },
    { threshold: 0.45 },
  );
  for (const root of $$("[data-demo]")) play.observe(root);

  const reveal = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        reveal.unobserve(e.target);
        e.target.classList.add("in");
      }
    },
    { threshold: 0.15 },
  );
  const revealed =
    ".logos p, .logos__grid li, .features__index button, .features__stage, .facts3 > div, .quote blockquote, .quote figcaption, .quote__photo, .close > *";
  for (const el of $$(revealed)) {
    const i = [...el.parentElement.children].indexOf(el);
    el.style.setProperty("--d", `${Math.min(i, 9) * 60}ms`);
    el.classList.add("reveal");
    reveal.observe(el);
  }

  /* Scroll progress: --p runs 0 to 1 while an element's top travels between two viewport fractions */
  const tracked = $$("[data-scroll]").map((el) => [
    el,
    ...el.dataset.scroll.split(" ").map(Number),
  ]);
  let queued = false;
  const track = () => {
    queued = false;
    for (const [el, from, to] of tracked) {
      const p =
        (from * innerHeight - el.getBoundingClientRect().top) /
        ((from - to) * innerHeight);
      el.style.setProperty("--p", Math.max(0, Math.min(1, p)).toFixed(3));
    }
  };
  const onScroll = () =>
    queued || ((queued = true), requestAnimationFrame(track));
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  track();
}
