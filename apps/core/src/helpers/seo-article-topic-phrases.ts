/** Use words from a public article heading, preserving the publisher's spelling and language. */
const generic = new Set(
  (
    "a an the of for to and how what why with from your our this these best top new easy simple complete ultimate essential practical beginner beginners advanced guide guides tips step by steps news latest update updates learn more introduction about part chapter series article articles blog review reviews overview tutorial tutorials " +
    "der die das und von für zum zur wie eine einer ein neu beste besten ratgeber leitfaden schritt tipps überblick teil aktuell nachrichten " +
    "le la les des du de et pour comment un une au aux guide conseils actualités introduction partie " +
    "el los las del para como cómo una guía consejos noticias parte " +
    "di della gli per come guida consigli il do da dos das para um uma guia dicas van het een en hoe gids"
  ).split(" "),
);
export const topicKey = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const genericSections = new Set(
  "blog blogs news articles article posts post updates stories latest guides guide tips pages products categories category archive resources uncategorized allgemein beiträge nachrichten actualités noticias novedades nouvelles neuigkeiten".split(
    " ",
  ),
);
export const validArticleSection = (label: string) =>
  !genericSections.has(topicKey(label));
const words = (s: string) =>
  [...s.matchAll(/[\p{L}\p{M}][\p{L}\p{M}\p{N}]*/gu)].map((m) => m[0]);
export function topicInSlug(url: string, topic: string) {
  const address = new URL(url);
  const key = topicKey(topic);
  if (
    address.hostname
      .split(".")
      .some((label) => label.replace(/-/g, "") === key.replace(/ /g, ""))
  )
    return false;
  try {
    const slug = decodeURIComponent(
      address.pathname.split("/").filter(Boolean).at(-1) ?? "",
    );
    return (" " + words(topicKey(slug)).join(" ") + " ").includes(
      " " + key + " ",
    );
  } catch {
    return false;
  }
}
export function headlinePhrases(
  headline: string,
  url: string,
): Map<string, string> {
  const phrases = new Map<string, string>();
  const section = headline.split(/\s*[|:•·]\s*|\s+[–—-]\s+/u)[0].trim();
  const parts = words(section);
  if (parts.length > 20 || parts.length < 2) return phrases;
  for (let size = Math.min(4, parts.length); size >= 2; size--)
    for (let i = 0; i + size <= parts.length; i++) {
      const phrase = parts.slice(i, i + size).join(" "),
        key = topicKey(phrase);
      // Independent path evidence excludes shared title furniture. A complete heading prefix can identify a series explicitly.
      if (
        !topicKey(section).includes(key) ||
        key.length < 7 ||
        key.length > 96 ||
        words(key).some((w) => w.length < 2 || generic.has(w)) ||
        (!topicInSlug(url, key) &&
          !(section !== headline && key === topicKey(section)))
      )
        continue;
      phrases.set(key, phrase);
    }
  return phrases;
}
export function queryContainsTopic(query: string, topic: string) {
  return (" " + words(topicKey(query)).join(" ") + " ").includes(
    " " + words(topicKey(topic)).join(" ") + " ",
  );
}
