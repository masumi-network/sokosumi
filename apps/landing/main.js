const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* Product name: set once in <meta name="product-name"> */
const productName = document.querySelector(
  'meta[name="product-name"]',
)?.content;
if (productName) {
  for (const el of $$("[data-name]")) el.textContent = productName;
  for (const el of $$("[data-slug]"))
    el.textContent = productName.toLowerCase();
}

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

/* Hero screenshots: cross-fade through the app, or pick one */
for (const root of $$("[data-shots]")) {
  const imgs = $$("img", root);
  const btns = $$("button", root);
  let current = 0;
  let timer;
  const show = (n) => {
    current = n % imgs.length;
    for (const [i, img] of imgs.entries())
      img.classList.toggle("on", i === current);
    for (const [i, btn] of btns.entries())
      btn.setAttribute("aria-pressed", String(i === current));
  };
  const play = () => {
    clearInterval(timer);
    if (!reduced) timer = setInterval(() => show(current + 1), 4500);
  };
  for (const [i, btn] of btns.entries())
    btn.addEventListener("click", () => {
      show(i);
      play();
    });
  play();
}

/* Features: the text on the left follows the screenshot in the middle of the screen */
const features = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const f of $$(".feature"))
        f.classList.toggle("on", f.contains(e.target));
    }
  },
  { rootMargin: "-50% 0px -50% 0px" },
);
for (const tray of $$(".feature .tray")) features.observe(tray);

if (!reduced) {
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
    ".logos p, .logos__grid li, .feature .tray, .replaces > div, .replaces li, .facts3 > div, .quote blockquote, .quote figcaption, .quote__photo, .close > *, .install__works, .block > h2, .steps li, .toolset > div, .toolset li";
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
