import { isPublicSeoSitemapPage } from "@sokosumi/utils";
import { SEO_MAX_PAGES } from "./seo-form-model";

const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const MAX_XML_URL_CHARS = 2048;
export const MAX_SITEMAP_IMPORT_BYTES = 512 * 1024;

/** Read only direct page locations. Metadata, extension URLs and XML processing instructions cannot add page hints. */
export function importedSitemapHints(xml: string, seed: string) {
  if (
    xml.length > MAX_SITEMAP_IMPORT_BYTES ||
    /<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(xml)
  )
    throw new Error("Unsupported sitemap XML");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (
    doc.getElementsByTagName("parsererror").length ||
    root.localName !== "urlset" ||
    root.namespaceURI !== SITEMAP_NS
  )
    throw new Error("Expected a sitemap URL set");
  const primary = new URL(seed);
  const hints = new Set<string>();
  for (const entry of Array.from(root.children)) {
    if (entry.localName !== "url" || entry.namespaceURI !== SITEMAP_NS)
      continue;
    const locations = Array.from(entry.children).filter(
      (el) => el.localName === "loc" && el.namespaceURI === SITEMAP_NS,
    );
    if (locations.length !== 1 || locations[0].childElementCount) continue;
    const text = locations[0].textContent?.trim() ?? "";
    const url = URL.parse(text);
    if (
      !url ||
      !isPublicSeoSitemapPage(text) ||
      (url.hostname !== primary.hostname &&
        url.hostname !== "www." + primary.hostname &&
        primary.hostname !== "www." + url.hostname) ||
      url.port !== primary.port ||
      (url.protocol !== primary.protocol && url.protocol !== "https:") ||
      /[?#]/.test(text) ||
      text.length >= MAX_XML_URL_CHARS
    )
      continue;
    hints.add(url.href);
    if (hints.size >= SEO_MAX_PAGES) break;
  }
  if (!hints.size) throw new Error("No public page hints from this site");
  return [...hints];
}

/** A partial XML file for review. Never claim all pages on the site were crawled. */
export function sitemapDraftXml(
  targets: readonly { targetUrl: string; sitemapEligible?: true }[],
) {
  const urls = targets
    .filter(
      (row) =>
        row.sitemapEligible &&
        row.targetUrl.length < MAX_XML_URL_CHARS &&
        isPublicSeoSitemapPage(row.targetUrl),
    )
    .map((row) => row.targetUrl);
  if (
    !urls.length ||
    new Set(urls.map((value) => new URL(value).origin)).size !== 1
  )
    return null;
  const loc = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!-- Partial audit sample. Review before publishing. -->",
    `<urlset xmlns="${SITEMAP_NS}">`,
    ...[...new Set(urls)]
      .sort()
      .map((url) => `  <url><loc>${loc(url)}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
}
