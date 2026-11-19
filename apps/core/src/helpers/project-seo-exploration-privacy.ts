// Keep public opportunity excerpts and citation URLs within the same boundary as the SEO worker.
const PRIVATE_PATH =
  /(?:^|\/)(?:accounts?|admin|auth|invites?|login|logout|password|private|profiles?|reset[-_]?password|sessions?|tokens?|users?)(?:\/|$)/iu;
const PRIVATE_TEXT =
  /[<>@\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]|(?:https?:\/\/|www\.|\b(?:bearer\s+|(?:password|secret|token|api[_ -]?key)\s*[:=]))/iu;
const CONTACT_OR_IDENTIFIER =
  /\+[1-9]\d{0,2}[ (.-]*(?:\d[ ().-]*){7,14}\d|\(\d{3}\)\s*\d{3}[- .]\d{4}|\b[a-f\d]{32,}\b|\b[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\b/iu;
/** Check route-shaped words without treating ratios, date ranges or a standalone slash as links. */
function hasPrivateRoute(text: string): boolean {
  if (!/[/\\%]/u.test(text)) return false;
  for (const [word] of text.matchAll(/[^\s<>"'“”‘’()\[\]{}`]+/gu)) {
    if (!/[/\\]|%(?:2f|5c|25)/iu.test(word)) continue;
    try {
      const path = decodeURIComponent(word.replace(/[.,!?:;]+$/u, ""));
      if (
        /\/\/[^/]|[%\\?#=;]/u.test(path) ||
        PRIVATE_PATH.test(path) ||
        PRIVATE_TEXT.test(path) ||
        CONTACT_OR_IDENTIFIER.test(path)
      )
        return true;
    } catch {
      return true;
    }
  }
  return false;
}
export const publicExplorationText = (text: string) =>
  !PRIVATE_TEXT.test(text) &&
  !CONTACT_OR_IDENTIFIER.test(text) &&
  !hasPrivateRoute(text);

export function publicExplorationUrl(value: string): boolean {
  const u = URL.parse(value);
  if (!u || !/^https?:$/.test(u.protocol) || u.username || u.password)
    return false;
  if (u.search || u.hash || u.href !== value) return false;
  try {
    const path = decodeURIComponent(u.pathname);
    return (
      !/[@%?#=;\\<>\s\p{Cc}]/u.test(path) &&
      !PRIVATE_PATH.test(path) &&
      !CONTACT_OR_IDENTIFIER.test(path)
    );
  } catch {
    return false;
  }
}
