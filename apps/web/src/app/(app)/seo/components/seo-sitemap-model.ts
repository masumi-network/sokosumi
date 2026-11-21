import { isPublicSeoSitemapPage } from "@sokosumi/utils";
import { SaxesParser } from "saxes";
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
  const primary = new URL(seed);
  const hints = new Set<string>();
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  let inEntry = false;
  let locationCount = 0;
  let inLocation = false;
  let location = "";

  parser.on("opentag", (tag) => {
    depth++;
    const sitemapTag = tag.uri === SITEMAP_NS;
    if (depth === 1 && (!sitemapTag || tag.local !== "urlset"))
      throw new Error("Expected a sitemap URL set");
    if (depth === 2) {
      inEntry = sitemapTag && tag.local === "url" && hints.size < SEO_MAX_PAGES;
      locationCount = 0;
      location = "";
    }
    if (inEntry && depth === 3 && sitemapTag && tag.local === "loc") {
      locationCount++;
      inLocation = locationCount === 1;
    } else if (inLocation) {
      // A location containing an element is not a plain page address.
      location = "";
      inLocation = false;
    }
  });
  const appendText = (text: string) => {
    if (inLocation) location += text;
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", () => {
    if (depth === 3) inLocation = false;
    if (depth === 2 && inEntry && locationCount === 1) {
      const text = location.trim();
      if (text.length < MAX_XML_URL_CHARS && isPublicSeoSitemapPage(text)) {
        const url = new URL(text);
        if (
          (url.hostname === primary.hostname ||
            url.hostname === "www." + primary.hostname ||
            primary.hostname === "www." + url.hostname) &&
          url.port === primary.port &&
          (url.protocol === primary.protocol || url.protocol === "https:") &&
          !/[?#]/.test(text)
        )
          hints.add(url.href);
      }
    }
    depth--;
  });
  parser.write(xml).close();
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
