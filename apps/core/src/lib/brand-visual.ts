import { ssrfSafeFetch } from "@sokosumi/net";
import {
  brandColors,
  brandFonts,
  distinctColors,
  isNeutral,
  normalizeHex,
} from "@sokosumi/utils";

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
