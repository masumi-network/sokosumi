(() => {
  let saved;
  try { saved = localStorage.getItem("theme"); } catch {}
  const dark = saved === "dark" || saved === "light" ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
