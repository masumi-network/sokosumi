import { ssrfSafeFetch } from "@sokosumi/net";

import { socialLinks } from "@/soko-bot-runner/local-tools";

import { MIN_PAGE_CHARS, pageLines, stableLines } from "./page-diff";
import { bareHost } from "./text";

/** Says who is reading and where to complain, as a polite crawler does. */
const HEADERS = {
  "User-Agent": "CMOxyzBot/1.0 (+https://cmo.xyz; competitor page check)",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};
const TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 3_000_000;

export interface CompetitorPage {
  /** Where the page was read after redirects. */
  url: string;
  html: string;
  /** What both reads of it show, one statement per line. */
  lines: string[];
}

async function fetchHtml(
  url: string,
): Promise<{ html: string; url: string } | null> {
  let finalUrl = url;
  const response = await ssrfSafeFetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    maxResponseBytes: MAX_HTML_BYTES,
    onFinalUrl: (final) => {
      finalUrl = final;
    },
  });
  if (!response.ok) return null;
  if (!(response.headers.get("content-type") ?? "").includes("html"))
    return null;
  return { html: await response.text(), url: finalUrl };
}

/**
 * Reads a page twice and keeps what both reads show, so a banner or
 * testimonial that rotates per visit never counts as a change. Null when the
 * page does not load as HTML or shows too little text to compare (a
 * JavaScript shell, a bot block).
 */
export async function readCompetitorPage(
  url: string,
): Promise<CompetitorPage | null> {
  // One after the other: at once, a cache tends to serve the same copy twice.
  const first = await fetchHtml(url);
  const second = first ? await fetchHtml(url) : null;
  if (!first || !second) return null;
  const lines = stableLines(pageLines(first.html), pageLines(second.html));
  if (lines.join("\n").length < MIN_PAGE_CHARS) return null;
  return { url: first.url, html: first.html, lines };
}

const PRICING_PATH =
  /\/(?:pricing|prices?|plans?|preise|tarifs?|precios)(?:[/.-][\w-]*)?\/?$/i;

/** The pricing page a homepage links to, on the same site. */
export function pricingLink(html: string, pageUrl: string): string | null {
  const base = URL.parse(pageUrl);
  if (!base) return null;
  for (const [, href = ""] of html.matchAll(
    /<a\b[^>]*\bhref=["']([^"']+)["']/gi,
  )) {
    const url = URL.parse(href.replace(/&amp;/g, "&"), base);
    if (
      url &&
      (url.protocol === "https:" || url.protocol === "http:") &&
      bareHost(url.hostname) === bareHost(base.hostname) &&
      PRICING_PATH.test(url.pathname)
    ) {
      url.search = "";
      url.hash = "";
      return url.href;
    }
  }
  return null;
}

/** The first profile a homepage links to on a network, as its handle. */
export function profileHandle(
  html: string,
  host: "instagram.com" | "facebook.com",
): string | null {
  for (const link of socialLinks(html)) {
    const url = URL.parse(link);
    if (url?.hostname !== host) continue;
    const handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (
      /^[a-z0-9._-]{2,80}$/i.test(handle) &&
      !RESERVED.has(handle.toLowerCase())
    )
      return handle.toLowerCase();
  }
  return null;
}

const RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "explore",
  "stories",
  "tv",
  "pages",
  "groups",
  "events",
  "profile.php",
  "people",
  "watch",
  "login",
  "help",
  "policies",
  "privacy",
]);
