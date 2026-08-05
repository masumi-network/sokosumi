/** Decoded OG/Twitter/title fields from HTML (no I/O). */
export interface OpenGraphFields {
  title: string | null;
  description: string | null;
  /** May be relative; caller resolves against the page URL. */
  image: string | null;
  siteName: string | null;
}

/** One successful page preview stored under metadata.unfurls[i]. */
export interface ChatRoomMessageUnfurlCard {
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

/** Only the head matters for meta/title, so we never parse beyond this. */
const MAX_HTML_BYTES = 512 * 1024;

/** Decode the handful of entities that actually show up inside content/title. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

/** Read an attribute, accepting quoted or bare values, and decode entities. */
function attr(tag: string, name: string): string | undefined {
  const quoted = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"),
  );
  if (quoted?.[1] !== undefined) return decodeEntities(quoted[1]);
  const bare = tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s"'>]+)`, "i"));
  return bare?.[1] === undefined ? undefined : decodeEntities(bare[1]);
}

function firstNonEmpty(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/**
 * Parse og:/twitter: meta (+ `<title>` fallback) from HTML.
 * No I/O. Relative image left unresolved.
 */
export function parseOpenGraphFields(html: string): OpenGraphFields {
  const head = html.slice(0, MAX_HTML_BYTES);

  let ogTitle: string | null = null;
  let ogDescription: string | null = null;
  let ogImage: string | null = null;
  let ogSiteName: string | null = null;
  let twitterTitle: string | null = null;
  let twitterDescription: string | null = null;
  let twitterImage: string | null = null;

  for (const match of head.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const tag = match[0];
    const prop = (
      attr(tag, "property") ??
      attr(tag, "name") ??
      ""
    ).toLowerCase();
    const content = attr(tag, "content");
    if (content === undefined) continue;

    switch (prop) {
      case "og:title":
        ogTitle ??= content;
        break;
      case "og:description":
        ogDescription ??= content;
        break;
      case "og:image":
        ogImage ??= content;
        break;
      case "og:site_name":
        ogSiteName ??= content;
        break;
      case "twitter:title":
        twitterTitle ??= content;
        break;
      case "twitter:description":
        twitterDescription ??= content;
        break;
      case "twitter:image":
        twitterImage ??= content;
        break;
      default:
        break;
    }
  }

  let documentTitle: string | null = null;
  const titleMatch = head.match(/<title\b[^>]*>([^<]*)<\/title>/i);
  if (titleMatch?.[1] !== undefined) {
    documentTitle = decodeEntities(titleMatch[1]).trim() || null;
  }
  // YouTube bot interstitial: `<title> - YouTube</title>` with no OG tags.
  if (documentTitle !== null && /^-\s*YouTube$/i.test(documentTitle)) {
    documentTitle = null;
  }

  return {
    title: firstNonEmpty(ogTitle, twitterTitle, documentTitle),
    description: firstNonEmpty(ogDescription, twitterDescription),
    image: firstNonEmpty(ogImage, twitterImage),
    siteName: firstNonEmpty(ogSiteName),
  };
}

function resolveHttpUrl(candidate: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(candidate, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

/** Prefer OG site name; else hostname from the fetched / requested URL. */
function resolveSiteName(
  fields: OpenGraphFields,
  requestedUrl: string,
  finalUrl: string,
): string | null {
  const fromOg = fields.siteName?.trim() ?? "";
  if (fromOg.length > 0) {
    return fromOg;
  }
  for (const candidate of [finalUrl, requestedUrl]) {
    try {
      const host = new URL(candidate).hostname.trim();
      if (host.length > 0) {
        return host;
      }
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Turn OG fields + fetch URL into a DTO card, or null if title missing.
 * Resolves relative image against `finalUrl`; drops non-http(s) image URLs.
 */
export function toUnfurlCard(
  fields: OpenGraphFields,
  requestedUrl: string,
  finalUrl: string,
): ChatRoomMessageUnfurlCard | null {
  const title = fields.title?.trim() ?? "";
  if (title.length === 0) {
    return null;
  }

  const imageUrl = fields.image ? resolveHttpUrl(fields.image, finalUrl) : null;

  return {
    url: requestedUrl,
    title,
    description: fields.description,
    imageUrl,
    siteName: resolveSiteName(fields, requestedUrl, finalUrl),
  };
}
