(() => {
  const KEY = "cmo-cookie-consent-v1";
  const MAX_AGE = 180 * 24 * 60 * 60 * 1000;
  const tagId = document.currentScript?.dataset.analytics;
  const privacyUrl = "https://www.cmo.xyz/privacy#cookies-and-similar-storage";
  let panel;
  let opener;
  let loaded = false;

  function readChoice() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && ["accepted", "rejected"].includes(saved.choice) &&
          Number.isFinite(saved.at) && saved.at <= Date.now() && Date.now() - saved.at < MAX_AGE) return saved.choice;
    } catch {}
    return null;
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
    if (!tagId || loaded || navigator.globalPrivacyControl === true) return;
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
    if (navigator.globalPrivacyControl === true) choice = "rejected";
    try { localStorage.setItem(KEY, JSON.stringify({ choice, at: Date.now() })); } catch {}
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
    panel.setAttribute("aria-label", "Cookie choices");
    const title = document.createElement("h2");
    title.textContent = "Your cookie choices";
    const copy = document.createElement("p");
    copy.textContent = "We use necessary storage to remember your choices. With your permission, Google Analytics helps us understand visits and clicks. You can change your choice at any time.";
    const link = document.createElement("a");
    link.href = privacyUrl;
    link.textContent = "Read about cookies";
    const buttons = document.createElement("div");
    buttons.className = "cookie-actions";
    for (const [choice, label] of [["rejected", "Reject analytics"], ["accepted", "Allow analytics"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.cookieChoice = choice;
      button.disabled = choice === "accepted" && navigator.globalPrivacyControl === true;
      button.addEventListener("click", () => saveChoice(choice));
      buttons.append(button);
    }
    if (navigator.globalPrivacyControl === true) {
      copy.textContent = "Your Global Privacy Control signal blocks optional analytics. Necessary storage still works. You can keep this choice by choosing Reject analytics.";
    }
    panel.append(title, copy, link, buttons);
    document.body.append(panel);
    if (opener) buttons.querySelector("button").focus();
  }

  for (const button of document.querySelectorAll("[data-cookie-settings]")) {
    button.addEventListener("click", () => { opener = button; showChoices(); });
  }
  const choice = readChoice();
  if (navigator.globalPrivacyControl === true || choice === "rejected") {
    clearAnalyticsCookies();
  } else if (choice === "accepted") {
    loadAnalytics();
  } else if (tagId) {
    clearAnalyticsCookies();
    showChoices();
  }
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) location.reload();
  });
})();
