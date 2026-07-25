import { ssrfSafeFetch } from "@sokosumi/net";

import { uploadOrganizationLogoBytes } from "@/lib/blob";

/** Only the head matters for icon links, so we never parse beyond this. */
const MAX_HTML_BYTES = 512 * 1024;
/**
 * Transfer cap for the page itself. `ssrfSafeFetch` rejects (rather than
 * truncates) once this is exceeded, and real marketing pages are routinely
 * over 512 KB — so this bounds abuse without failing legitimate sites.
 */
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
/** Cap a downloaded icon; favicons/logos are well under this. */
const MAX_ICON_BYTES = 2 * 1024 * 1024;
/** Per-request budget. Without it a slow host stalls the whole Core request. */
const PAGE_TIMEOUT_MS = 8_000;
const ICON_TIMEOUT_MS = 8_000;
/** Only try this many candidates — the ranked list is long-tailed. */
const MAX_ICON_ATTEMPTS = 5;

/**
 * Some sites reject header-less requests outright (403). Identify honestly
 * rather than impersonating a browser.
 */
const REQUEST_HEADERS = {
  "User-Agent": "SokosumiBot/1.0 (+https://sokosumi.com)",
  Accept: "text/html,application/xhtml+xml,image/*,*/*;q=0.8",
} as const;

/** `rel` tokens we accept as a site icon, best-first. */
const APPLE_ICON_RELS = new Set([
  "apple-touch-icon",
  "apple-touch-icon-precomposed",
]);
const STANDARD_ICON_RELS = new Set(["icon", "shortcut icon", "shortcut"]);

/**
 * Apple touch icons are 180px+ by convention but rarely declare `sizes`.
 * Treating them as unsized would rank them below a 16px favicon.
 */
const ASSUMED_APPLE_ICON_SIZE = 180;

interface IconCandidate {
  url: string;
  /** Largest declared square dimension in px, or 0 when unknown. */
  size: number;
  /** Higher = preferred source when sizes tie. */
  priority: number;
}

/** Decode the handful of entities that actually show up inside href/content. */
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

/**
 * Parse the max square dimension from a `sizes="16x16 32x32"` attribute.
 * `sizes="any"` (common on SVG favicons) is scalable, so it outranks any
 * fixed raster size.
 */
function parseSizes(sizes: string | undefined): number {
  if (!sizes) return 0;
  const normalized = sizes.trim().toLowerCase();
  if (normalized === "any") return Number.MAX_SAFE_INTEGER;
  let max = 0;
  for (const token of normalized.split(/\s+/)) {
    const match = token.match(/(\d+)x(\d+)/i);
    if (match) max = Math.max(max, Number(match[1]), Number(match[2]));
  }
  return max;
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

/**
 * Pull icon candidates out of page HTML: apple-touch-icon and `<link rel=icon>`
 * (ranked by declared size), then og:image as a lower-priority fallback.
 * Relative hrefs are resolved against `baseUrl`.
 */
export function parseIconCandidates(
  html: string,
  baseUrl: string,
): IconCandidate[] {
  const candidates: IconCandidate[] = [];
  const head = html.slice(0, MAX_HTML_BYTES);

  for (const match of head.matchAll(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const tag = match[0];
    const rel = attr(tag, "rel")?.toLowerCase().trim();
    const href = attr(tag, "href");
    if (!rel || !href) continue;

    // Exact rel matching: a substring test also catches `mask-icon` (a
    // monochrome silhouette) and `fluid-icon`, which make poor logos.
    const isApple = APPLE_ICON_RELS.has(rel);
    if (!isApple && !STANDARD_ICON_RELS.has(rel)) continue;

    let resolved: string;
    try {
      resolved = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }

    const declaredSize = parseSizes(attr(tag, "sizes"));
    candidates.push({
      url: resolved,
      size:
        isApple && declaredSize === 0 ? ASSUMED_APPLE_ICON_SIZE : declaredSize,
      // Apple touch icons are typically 180px+ and square — best logo source.
      priority: isApple ? 3 : 2,
    });
  }

  for (const match of head.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const tag = match[0];
    const prop = (
      attr(tag, "property") ??
      attr(tag, "name") ??
      ""
    ).toLowerCase();
    if (prop !== "og:image" && prop !== "twitter:image") continue;
    const content = attr(tag, "content");
    if (!content) continue;
    try {
      candidates.push({
        url: new URL(content, baseUrl).toString(),
        size: 0,
        priority: 1,
      });
    } catch {}
  }

  return candidates;
}

/** Rank best-first: source priority wins, then larger declared size. */
export function rankCandidates(candidates: IconCandidate[]): IconCandidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
    .sort((a, b) => b.priority - a.priority || b.size - a.size);
}

async function fetchIconBytes(
  url: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  let response: Response;
  try {
    response = await ssrfSafeFetch(url, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(ICON_TIMEOUT_MS),
      maxResponseBytes: MAX_ICON_BYTES,
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim();
  if (!contentType.startsWith("image/")) return null;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ICON_BYTES) return null;
  return { bytes, contentType };
}

/**
 * Best-effort: fetch a site's highest-quality icon and persist it as an
 * organization-logo blob. Returns the public blob URL, or null when nothing
 * usable is found (caller falls back to the client-side favicon guesser).
 *
 * SSRF-guarded end to end — the page HTML and every icon are fetched via
 * `ssrfSafeFetch`, so a hostile URL can't reach private networks.
 */
export async function resolveSiteIconAsOrganizationLogo(
  rawUrl: string,
): Promise<string | null> {
  let pageUrl: URL;
  try {
    pageUrl = new URL(
      /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`,
    );
  } catch {
    return null;
  }

  const candidates: IconCandidate[] = [];

  // 1. Parse the page for declared icons.
  try {
    const response = await ssrfSafeFetch(pageUrl.toString(), {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      maxResponseBytes: MAX_PAGE_BYTES,
    });
    if (response.ok) {
      const html = await response.text();
      candidates.push(...parseIconCandidates(html, pageUrl.toString()));
    } else {
      console.warn(
        `[site-icon] page fetch for ${pageUrl.origin} returned ${response.status}`,
      );
    }
  } catch (error) {
    console.warn(`[site-icon] page fetch for ${pageUrl.origin} failed`, error);
  }

  // 2. Always add the well-known default as a last resort.
  candidates.push({
    url: new URL("/favicon.ico", pageUrl.origin).toString(),
    size: 0,
    priority: 0,
  });

  // 3. Fetch the first candidate that yields real image bytes and store it.
  for (const candidate of rankCandidates(candidates).slice(
    0,
    MAX_ICON_ATTEMPTS,
  )) {
    const icon = await fetchIconBytes(candidate.url);
    if (!icon) continue;
    const url = await uploadOrganizationLogoBytes({
      bytes: icon.bytes,
      contentType: icon.contentType,
    });
    if (url) return url;
    // Bytes were fine but storage refused them — retrying other candidates
    // will hit the same wall, so stop and let the caller fall back.
    console.warn(
      `[site-icon] storing the icon for ${pageUrl.origin} failed; is BLOB_READ_WRITE_TOKEN set?`,
    );
    return null;
  }

  console.warn(`[site-icon] no usable icon found for ${pageUrl.origin}`);
  return null;
}
