import { ssrfSafeFetch } from "@sokosumi/net";

import { decodeEntities } from "@/lib/open-graph-html";

/** What a brand looks like, read from its website. */
export interface BrandVisual {
  /** An image that reads as the brand: the site's logo or best icon. */
  logoUrl: string | null;
  /** Brand colours, most used first; neutrals (white, black, greys) left out. */
  colors: string[];
  /** Font families the site uses, most used first. */
  fonts: string[];
  /** The site's own name, from og:site_name or the title. */
  siteName: string | null;
  /** Photos from the site (og:image first), for post previews. */
  images: string[];
}

const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_CSS_BYTES = 1024 * 1024;
const TIMEOUT_MS = 8_000;
const HEADERS = {
  "User-Agent": "SokosumiBot/1.0 (+https://sokosumi.com)",
  Accept: "text/html,text/css,*/*;q=0.8",
} as const;

const GENERIC_FONTS = new Set([
  "inherit",
  "initial",
  "sans-serif",
  "serif",
  "monospace",
  "system-ui",
  "-apple-system",
  "blinkmacsystemfont",
  "segoe ui",
  "helvetica",
  "helvetica neue",
  "arial",
  "ui-sans-serif",
  "ui-monospace",
  "ui-serif",
  "apple color emoji",
  "segoe ui emoji",
  "segoe ui symbol",
  "noto color emoji",
  "var",
]);

function absolute(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  return match?.[1]?.trim() || null;
}

function metaContent(html: string, key: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = attr(tag, "property") ?? attr(tag, "name");
    if (name?.toLowerCase() === key) return attr(tag, "content");
  }
  return null;
}

/** "#abc" and "#aabbcc" as lower-case six digits; null for anything else. */
export function normalizeHex(value: string): string | null {
  const hex = value.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return `#${[...hex].map((digit) => digit + digit).join("")}`;
  }
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((part) =>
      Math.max(0, Math.min(255, Math.round(part)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Whites, blacks and greys say nothing about a brand. */
export function isNeutral(hex: string): boolean {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  return saturation < 0.18 || max < 28;
}

/** Colours in CSS (hex and rgb()), most frequent first, neutrals dropped. */
export function brandColors(css: string, limit = 5): string[] {
  const counts = new Map<string, number>();
  const add = (hex: string | null, weight = 1) => {
    if (!hex || isNeutral(hex)) return;
    counts.set(hex, (counts.get(hex) ?? 0) + weight);
  };
  for (const match of css.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    add(normalizeHex(match[0]));
  }
  for (const match of css.matchAll(
    /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/g,
  )) {
    add(rgbHex(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  // Custom properties named like brand colours weigh more than one-off uses.
  for (const match of css.matchAll(
    /--[\w-]*(?:brand|primary|accent)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,6})\b/gi,
  )) {
    add(normalizeHex(match[1] ?? ""), 5);
  }
  return distinctColors(
    [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex),
  ).slice(0, limit);
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/**
 * Colours in order, without near repeats: three navies a few shades apart
 * read as one brand colour.
 */
export function distinctColors(colors: string[], minDistance = 48): string[] {
  const kept: string[] = [];
  for (const color of colors) {
    const [r, g, b] = rgb(color);
    const near = kept.some((other) => {
      const [r2, g2, b2] = rgb(other);
      return Math.hypot(r - r2, g - g2, b - b2) < minDistance;
    });
    if (!near) kept.push(color);
  }
  return kept;
}

/** Code and icon faces say nothing about how a brand reads. */
const NOT_A_BRAND_FONT =
  /mono|menlo|monaco|consolas|courier|awesome|icon|glyph|symbol|emoji|dashicons|material/i;

/**
 * A family as people name it, or null when it says nothing about the brand:
 * generic families, metric fallbacks ("Inter Fallback") and CSS variables.
 * Next.js hashes ("__Inter_d65c78") read as "Inter".
 */
export function brandFontName(raw: string): string | null {
  const name = raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^_+/, "")
    .replace(/_[0-9a-f]{5,}$/i, "")
    .replace(/_/g, " ")
    .trim();
  if (!/^[A-Za-z][\w -]*$/.test(name) || /fallback/i.test(name)) return null;
  if (NOT_A_BRAND_FONT.test(name)) return null;
  return GENERIC_FONTS.has(name.toLowerCase()) ? null : name;
}

/** Font families declared in CSS, most frequent first, generic ones dropped. */
export function brandFonts(css: string, limit = 3): string[] {
  const counts = new Map<string, number>();
  const decoded = css.replace(/&quot;|&#0?34;|&#0?39;|&apos;/g, '"');
  for (const match of decoded.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
    const first = brandFontName((match[1] ?? "").split(",")[0] ?? "");
    if (first) counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([font]) => font)
    .slice(0, limit);
}

const NOT_OUR_LOGO =
  /badge|status|partner|customer|client|award|review|g2|capterra|trustpilot|featured|as-seen/;

/**
 * The site's own logo: an <img> that names itself the logo and is served by
 * the site or names the brand (customer and badge logos are left out), else
 * the apple-touch-icon.
 */
export function findLogo(html: string, base: string): string | null {
  const siteHost = new URL(base).hostname.replace(/^www\./, "");
  const brand = siteHost.split(".")[0] ?? siteHost;
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = attr(tag, "src");
    const url = src ? absolute(src, base) : null;
    if (!url) continue;
    const hint =
      `${attr(tag, "alt") ?? ""} ${attr(tag, "class") ?? ""} ${url}`.toLowerCase();
    if (!hint.includes("logo") || NOT_OUR_LOGO.test(hint)) continue;
    const host = new URL(url).hostname;
    if (host.endsWith(siteHost) || hint.includes(brand)) return url;
  }
  const icon = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((tag) => /apple-touch-icon/i.test(attr(tag, "rel") ?? ""));
  const href = icon ? attr(icon, "href") : null;
  return href ? absolute(href, base) : null;
}

const NOT_A_PHOTO =
  /logo|icon|avatar|badge|sprite|pixel|tracking|placeholder|spinner|loader|\.svg(?:$|\?)|\.gif(?:$|\?)/i;

/**
 * Photos that show the business: og:image, then the page's own large images
 * (logos, icons, badges and tracking pixels left out). Best effort.
 */
export function findImages(html: string, base: string, limit = 6): string[] {
  const found: string[] = [];
  const add = (src: string | null) => {
    const url = src ? absolute(decodeEntities(src), base) : null;
    if (url && !NOT_A_PHOTO.test(url) && !found.includes(url)) found.push(url);
  };
  add(metaContent(html, "og:image") ?? metaContent(html, "twitter:image"));
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    if (found.length >= limit) break;
    const tag = match[0];
    const width = Number(attr(tag, "width") ?? "0");
    const hint = `${attr(tag, "alt") ?? ""} ${attr(tag, "class") ?? ""}`;
    if ((width > 0 && width < 200) || NOT_A_PHOTO.test(hint)) continue;
    add(attr(tag, "src") ?? attr(tag, "data-src"));
  }
  return found.slice(0, limit);
}

/**
 * The business's name, from og:site_name or the title. A title often names
 * the page too ("About Us – Tartine Bakery"); the part that matches the
 * domain wins, else the first.
 */
export function siteNameFrom(html: string, base: string): string | null {
  const ogName = metaContent(html, "og:site_name");
  if (ogName) return decodeEntities(ogName).trim() || null;
  const title = /<title[^>]*>([^<]{1,600})<\/title>/i.exec(html)?.[1];
  if (!title) return null;
  const parts = decodeEntities(title)
    .split(/\s[|·–—:-]\s/)
    .map((part) => part.trim())
    .filter(Boolean);
  const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const brand = squash(
    new URL(base).hostname.replace(/^www\./, "").split(".")[0] ?? "",
  );
  const named = brand
    ? parts.find((part) => {
        const squashed = squash(part);
        return (
          squashed.length > 0 &&
          (squashed.includes(brand) || brand.includes(squashed))
        );
      })
    : undefined;
  return named ?? parts[0] ?? null;
}

async function fetchText(url: string, maxBytes: number): Promise<string> {
  const response = await ssrfSafeFetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    maxResponseBytes: maxBytes,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/**
 * Reads the brand's look from its homepage, or from the page entered when
 * the homepage does not load: logo, colours from its CSS (the page's own
 * styles plus up to two of its stylesheets) and theme-color, fonts and
 * photos. Best effort and SSRF-guarded; never throws.
 */
export async function readBrandVisual(rawUrl: string): Promise<BrandVisual> {
  const empty: BrandVisual = {
    logoUrl: null,
    colors: [],
    fonts: [],
    siteName: null,
    images: [],
  };
  let entered: URL;
  try {
    entered = new URL(
      /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`,
    );
  } catch {
    return empty;
  }
  let page = new URL("/", entered);
  let html: string;
  try {
    html = await fetchText(page.toString(), MAX_PAGE_BYTES);
  } catch {
    if (page.toString() === entered.toString()) return empty;
    page = entered;
    try {
      html = await fetchText(page.toString(), MAX_PAGE_BYTES);
    } catch {
      return empty;
    }
  }
  const inline = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1] ?? "")
    .join("\n");
  const styleAttrs = [...html.matchAll(/style\s*=\s*"([^"]*)"/gi)]
    .map((match) => match[1] ?? "")
    .join(";");
  const sheets = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /stylesheet/i.test(attr(tag, "rel") ?? ""))
    .map((tag) => absolute(attr(tag, "href") ?? "", page.toString()))
    .filter((href): href is string => href !== null)
    .slice(0, 2);
  const linked = (
    await Promise.all(
      sheets.map((href) => fetchText(href, MAX_CSS_BYTES).catch(() => "")),
    )
  ).join("\n");
  const css = `${inline}\n${styleAttrs}\n${linked}`;
  const themeColor = normalizeHex(metaContent(html, "theme-color") ?? "");
  const colors = brandColors(css);
  return {
    logoUrl: findLogo(html, page.toString()),
    colors: distinctColors([
      ...(themeColor && !isNeutral(themeColor) ? [themeColor] : []),
      ...colors,
    ]).slice(0, 5),
    fonts: brandFonts(css),
    siteName: siteNameFrom(html, page.toString()),
    images: findImages(html, page.toString()),
  };
}
