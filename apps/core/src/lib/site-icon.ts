import { ssrfSafeFetch } from "@sokosumi/net";

import { uploadOrganizationLogoBytes } from "@/lib/blob";

/** Cap the HTML we read while hunting for icon links — real markup is small. */
const MAX_HTML_BYTES = 512 * 1024;
/** Cap a downloaded icon; favicons/logos are well under this. */
const MAX_ICON_BYTES = 2 * 1024 * 1024;

interface IconCandidate {
  url: string;
  /** Largest declared square dimension in px, or 0 when unknown. */
  size: number;
  /** Higher = preferred source when sizes tie. */
  priority: number;
}

/** Parse the max square dimension from a `sizes="16x16 32x32"` attribute. */
function parseSizes(sizes: string | undefined): number {
  if (!sizes) return 0;
  let max = 0;
  for (const token of sizes.trim().split(/\s+/)) {
    const match = token.match(/(\d+)x(\d+)/i);
    if (match) max = Math.max(max, Number(match[1]), Number(match[2]));
  }
  return max;
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1];
}

/**
 * Pull icon candidates out of page HTML: apple-touch-icon and `<link rel=icon>`
 * (ranked by declared size), then og:image as a lower-priority fallback.
 * Relative hrefs are resolved against `baseUrl`.
 */
function parseIconCandidates(html: string, baseUrl: string): IconCandidate[] {
  const candidates: IconCandidate[] = [];
  const head = html.slice(0, MAX_HTML_BYTES);

  for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = attr(tag, "rel")?.toLowerCase();
    const href = attr(tag, "href");
    if (!rel || !href) continue;
    if (!/\bicon\b/.test(rel)) continue;
    const isApple = rel.includes("apple-touch-icon");
    let resolved: string;
    try {
      resolved = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    candidates.push({
      url: resolved,
      size: parseSizes(attr(tag, "sizes")),
      // Apple touch icons are typically 180px+ and square — best logo source.
      priority: isApple ? 3 : 2,
    });
  }

  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
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

/** Rank best-first: larger declared size wins, then source priority. */
function rankCandidates(candidates: IconCandidate[]): IconCandidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
    .sort((a, b) => b.size - a.size || b.priority - a.priority);
}

async function fetchIconBytes(
  url: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  let response: Response;
  try {
    response = await ssrfSafeFetch(url);
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
    const response = await ssrfSafeFetch(pageUrl.toString());
    if (response.ok) {
      const html = await response.text();
      candidates.push(...parseIconCandidates(html, pageUrl.toString()));
    }
  } catch {
    // Ignore — fall through to the well-known default below.
  }

  // 2. Always add the well-known default as a last resort.
  candidates.push({
    url: new URL("/favicon.ico", pageUrl.origin).toString(),
    size: 0,
    priority: 0,
  });

  // 3. Fetch the first candidate that yields real image bytes and store it.
  for (const candidate of rankCandidates(candidates)) {
    const icon = await fetchIconBytes(candidate.url);
    if (!icon) continue;
    const url = await uploadOrganizationLogoBytes({
      bytes: icon.bytes,
      contentType: icon.contentType,
    });
    if (url) return url;
  }

  return null;
}
