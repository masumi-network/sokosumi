// Keep public opportunity excerpts and citation URLs within the same boundary as the SEO worker.
const PRIVATE_PATH =
  /(?:^|\/)(?:accounts?|admin|auth|invites?|login|logout|password|private|profiles?|reset[-_]?password|sessions?|tokens?|users?)(?:\/|$)/iu;
const PRIVATE_TEXT =
  /[<>@\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]|(?:https?:\/\/|www\.|\b(?:bearer\s+|(?:password|secret|token|api[_ -]?key)\s*[:=]))/iu;
const CONTACT_OR_IDENTIFIER =
  /\+[1-9]\d{0,2}[ (.-]*(?:\d[ ().-]*){7,14}\d|\(\d{3}\)\s*\d{3}[- .]\d{4}|\b[a-f\d]{32,}\b|\b[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\b/iu;
const TRAILING_PROSE_PUNCTUATION = ".,!?:;";

/** Check route-shaped words without treating ratios, date ranges or a standalone slash as links. */
function hasPrivateRoute(text: string): boolean {
  if (!/[/\\%]/u.test(text)) return false;
  for (const [word] of text.matchAll(/[^\s<>"'“”‘’()\[\]{}`]+/gu)) {
    if (!/[/\\]|%(?:2f|5c|25)/iu.test(word)) continue;
    try {
      let end = word.length;
      while (
        end > 0 &&
        TRAILING_PROSE_PUNCTUATION.includes(word.charAt(end - 1))
      )
        end--;
      const path = decodeURIComponent(word.slice(0, end));
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

const PRIVATE_PAGE =
  /(?:^|\/)(?:accounts?|my[-_]account|login|log-in|logout|log-out|sign-in|sign-out|sign-up|signin|signout|signup|register|admin|wp-admin|wp-login|auth|oauth|session|dashboard|settings|profile|billing|checkout|cart|basket|subscribe|unsubscribe|privacy(?:-policy)?|terms(?:-of-(?:use|service)|-and-conditions)?|cookies?(?:-policy)?|legal|impressum)(?:\.[a-z0-9]+)?(?:\/|$)/i;
const FILE_PAGE =
  /\.(?:pdf|zip|gz|tar|json|xml|csv|txt|jpe?g|png|gif|svg|webp|mp[34]|css|js|woff2?|ttf|docx?|xlsx?)$/i;

export function isSeoUtilityOrFilePath(path: string) {
  return PRIVATE_PAGE.test(path) || FILE_PAGE.test(path);
}

export function isPublicSeoSitemapPage(value: string) {
  if (!publicExplorationUrl(value)) return false;
  const url = new URL(value);
  const path = decodeURIComponent(url.pathname);
  return (
    !/%2f|%5c/i.test(url.pathname) &&
    !isSeoUtilityOrFilePath(path) &&
    !/\.(?:dmg|exe|msi|pkg|apk|deb|rpm|appimage|iso|tgz|7z|rar|pptx?|odt|ods|avif|ico|bmp|tiff?|m4a|wav|ogg|webm|mov|avi|otf)$/i.test(
      path,
    )
  );
}
