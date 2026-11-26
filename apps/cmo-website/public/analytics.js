// GA4 events for the landing page. gtag exists only after consent
// (cookie-consent.js), so every event is a no-op without it.
(() => {
  const APP = "app.cmo.xyz";

  function track(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params);
  }

  // What a link click means, or null for clicks GA's enhanced measurement already counts.
  function linkEvent(href, cta) {
    let url;
    try { url = new URL(href, "https://www.cmo.xyz/"); } catch { return null; }
    const location = cta || "inline";
    if (url.hostname === APP && url.pathname === "/signup") return ["sign_up_start", { cta_location: location }];
    if (url.hostname === APP && url.pathname === "/login") return ["login_start", { cta_location: location }];
    if (url.hostname === "cal.com") return ["schedule_call", { cta_location: location }];
    if (url.protocol === "mailto:") return ["contact_click", { cta_location: location }];
    if (url.hash && url.origin === "https://www.cmo.xyz" && url.pathname === "/") {
      return ["nav_click", { nav_target: url.hash.slice(1), cta_location: location }];
    }
    return null;
  }

  function plans() {
    return [...document.querySelectorAll(".tier")].map((tier, index) => ({
      item_id: tier.querySelector(".tier__name").textContent.trim().toLowerCase(),
      item_name: tier.querySelector(".tier__name").textContent.trim(),
      item_category: "plan",
      item_variant: "month",
      price: Number(tier.querySelector(".tier__price").firstChild.textContent.replace(/[^0-9.]/g, "")),
      index,
    }));
  }

  function onceVisible(element, callback) {
    if (!element || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      callback();
    }, { rootMargin: "0px 0px -50% 0px" });
    observer.observe(element);
  }

  function trackScrollDepth() {
    const marks = [25, 50, 75];
    addEventListener("scroll", () => {
      const scrollable = document.documentElement.scrollHeight - innerHeight;
      if (scrollable <= 0) return;
      const percent = (scrollY / scrollable) * 100;
      while (marks.length && percent >= marks[0]) track("scroll_depth", { percent_scrolled: marks.shift() });
    }, { passive: true });
  }

  function start() {
    document.addEventListener("click", (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link) return;
      const cta = link.dataset.cta;
      if (cta) track("cta_click", { cta_location: cta, cta_text: link.textContent.trim(), link_url: link.href });
      const mapped = linkEvent(link.getAttribute("href"), cta);
      if (mapped) track(...mapped);
    });
    for (const details of document.querySelectorAll(".faq details")) {
      details.addEventListener("toggle", () => {
        if (details.open) track("faq_open", { faq_question: details.querySelector("summary").textContent.trim() });
      });
    }
    onceVisible(document.getElementById("pricing"), () =>
      track("view_item_list", { item_list_id: "plans", item_list_name: "Pricing", items: plans() }));
    for (const id of ["month", "faq"]) onceVisible(document.getElementById(id), () => track("section_view", { section: id }));
    trackScrollDepth();
  }

  window.cmoAnalytics = { linkEvent, plans };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
