import { CMO_PATH_DEV_BRANDS } from "./brands";
import type { CmoPathBrand, CmoPathPage } from "./types";

/**
 * The fictional brands' sites. Their domains are under the reserved
 * `.example` TLD, which no real site can have, so answering them from here
 * never shadows a real page. Site capture, the brand's look and the bot's
 * web_fetch all read them through this one map; an unknown path is a 404.
 */
const registered = new Map<string, CmoPathBrand>(
  CMO_PATH_DEV_BRANDS.map((brand) => [brand.domain, brand]),
);

/** Adds brands kept outside the repo (the held-out set) for this process. */
export function registerCmoPathBrands(brands: readonly CmoPathBrand[]): void {
  for (const brand of brands) registered.set(brand.domain, brand);
}

function located(
  link: string,
): { brand: CmoPathBrand; page: CmoPathPage | null } | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.endsWith(".example")) return null;
  const brand = registered.get(host);
  if (!brand) return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return {
    brand,
    page: brand.pages.find((candidate) => candidate.path === path) ?? null,
  };
}

/**
 * The fixture's answer for a fictional brand's address, or null for every
 * other address (the caller fetches those as it always does).
 */
export function cmoPathSiteResponse(link: string): Response | null {
  if (!link.includes(".example")) return null;
  const found = located(link);
  if (!found) return null;
  if (!found.page)
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  return new Response(found.page.body, {
    status: 200,
    headers: { "content-type": `${found.page.contentType}; charset=utf-8` },
  });
}

/** The fictional sites as web pages for the eval web world: text, no markup. */
export function cmoPathWebPages(): {
  url: string;
  title: string;
  text: string;
}[] {
  return [...registered.values()].flatMap((brand) =>
    brand.pages
      .filter((page) => page.contentType === "text/html")
      .map((page) => ({
        url: `https://${brand.domain}${page.path === "/" ? "" : page.path}`,
        title:
          /<title>([^<]*)<\/title>/.exec(page.body)?.[1] ?? brand.eval.name,
        text: page.body
          .replace(/<(style|script)[\s\S]*?<\/\1>/g, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim(),
      })),
  );
}
