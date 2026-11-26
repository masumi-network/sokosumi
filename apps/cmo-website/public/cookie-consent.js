(() => {
  const KEY = "cmo-cookie-consent-v1";
  // Shared with app.cmo.xyz, so one choice covers both hosts.
  const COOKIE = "cmo_consent";
  const MAX_AGE = 180 * 24 * 60 * 60 * 1000;
  const tagId = document.currentScript?.dataset.analytics;
  const privacyUrl = "https://www.cmo.xyz/privacy#cookies-and-similar-storage";
  const gpc = navigator.globalPrivacyControl === true;
  let panel;
  let opener;
  let loaded = false;

  function sharedChoice() {
    const value = document.cookie.split(";").map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    return value === "granted" ? "accepted" : value === "denied" ? "rejected" : null;
  }

  function writeSharedChoice(choice) {
    const domain = /(^|\.)cmo\.xyz$/.test(location.hostname) ? "; domain=.cmo.xyz" : "";
    const value = choice === "accepted" ? "granted" : "denied";
    const maxAge = choice === "accepted" ? MAX_AGE / 1000 : 400 * 24 * 60 * 60;
    document.cookie = `${COOKIE}=${value}; Max-Age=${maxAge}; path=/; SameSite=Lax; Secure${domain}`;
  }

  function readChoice() {
    const shared = sharedChoice();
    if (shared) return shared;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved?.choice === "rejected") return "rejected";
      if (saved?.choice === "accepted" && Number.isFinite(saved.at) &&
          saved.at <= Date.now() && Date.now() - saved.at < MAX_AGE) return "accepted";
    } catch {}
    return null;
  }

  async function consentRequired() {
    try {
      const response = await fetch("/api/geo", { cache: "no-store" });
      return (await response.json()).consentRequired !== false;
    } catch {
      return true;
    }
  }

  function clearAnalyticsCookies() {
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0].trim();
      if (name !== "_ga" && !name.startsWith("_ga_")) continue;
      const domains = ["", location.hostname, ".cmo.xyz"];
      for (const domain of domains) {
        document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax${domain ? `; domain=${domain}` : ""}`;
      }
    }
  }

  function loadAnalytics() {
    if (!tagId || loaded || gpc) return;
    loaded = true;
    window[`ga-disable-${tagId}`] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("consent", "default", {
      analytics_storage: "granted", ad_storage: "denied",
      ad_user_data: "denied", ad_personalization: "denied",
    });
    window.gtag("js", new Date());
    window.gtag("config", tagId, {
      allow_google_signals: false, allow_ad_personalization_signals: false,
      cookie_expires: MAX_AGE / 1000, cookie_update: false,
    });
    const script = document.createElement("script");
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tagId)}`;
    script.async = true;
    document.head.append(script);
  }

  function saveChoice(choice) {
    if (gpc) choice = "rejected";
    try { localStorage.setItem(KEY, JSON.stringify({ choice, at: Date.now() })); } catch {}
    writeSharedChoice(choice);
    panel?.remove();
    panel = null;
    opener?.focus();
    if (choice === "accepted") {
      loadAnalytics();
    } else {
      if (tagId) window[`ga-disable-${tagId}`] = true;
      clearAnalyticsCookies();
      if (loaded) location.reload();
    }
  }

  function showChoices() {
    if (panel) return;
    panel = document.createElement("section");
    panel.className = "cookie-panel";
    panel.setAttribute("aria-label", "Your privacy choices");
    const title = document.createElement("h2");
    title.textContent = "Your privacy choices";
    const copy = document.createElement("p");
    copy.textContent = gpc
      ? "Your browser's Global Privacy Control signal is on, so Google Analytics stays off."
      : "Google Analytics helps us see which pages people visit. Allow it or turn it off. You can change this any time from Your Privacy Choices in the footer.";
    const link = document.createElement("a");
    link.href = privacyUrl;
    link.textContent = "How we use cookies";
    const buttons = document.createElement("div");
    buttons.className = "cookie-actions";
    for (const [choice, label] of [["rejected", "Reject analytics"], ["accepted", "Allow analytics"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.cookieChoice = choice;
      button.disabled = choice === "accepted" && gpc;
      button.addEventListener("click", () => saveChoice(choice));
      buttons.append(button);
    }
    panel.append(title, copy, link, buttons);
    document.body.append(panel);
    if (opener) buttons.querySelector("button").focus();
  }

  for (const button of document.querySelectorAll("[data-cookie-settings]")) {
    button.addEventListener("click", () => { opener = button; showChoices(); });
  }
  const choice = readChoice();
  // Choices saved before the shared cookie existed reach the app too.
  if (choice && !sharedChoice()) writeSharedChoice(choice);
  if (gpc || choice === "rejected") {
    clearAnalyticsCookies();
  } else if (choice === "accepted") {
    loadAnalytics();
  } else if (tagId) {
    clearAnalyticsCookies();
    consentRequired().then((required) => {
      if (readChoice()) return;
      if (required) showChoices();
      else loadAnalytics();
    });
  }
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) location.reload();
  });
})();
