import { isValidHttpUrl } from "@sokosumi/utils";
import { z } from "zod";

import { badRequest, conflict } from "@/helpers/error";
import { SEO_MAX_PAGES } from "@/schemas/project-seo.schema";
import { seoRelatedIndexingSelectionSchema } from "@/schemas/seo-task-pages.schema";

const requestObject = z.record(z.string(), z.json());
const PRIVATE_PAGE =
  /(?:^|\/)(?:accounts?|my[-_]account|login|log-in|logout|log-out|sign-in|sign-out|sign-up|signin|signout|signup|register|admin|wp-admin|wp-login|auth|oauth|session|dashboard|settings|profile|billing|checkout|cart|basket|subscribe|unsubscribe|privacy(?:-policy)?|terms(?:-of-(?:use|service)|-and-conditions)?|cookies?(?:-policy)?|legal|impressum)(?:\.[a-z0-9]+)?(?:\/|$)/i;
const FILE_PAGE =
  /\.(?:pdf|zip|gz|tar|json|xml|csv|txt|jpe?g|png|gif|svg|webp|mp[34]|css|js|woff2?|ttf|docx?|xlsx?)$/i;

function normalized(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

/** Match the worker's URL comparison without merging escaped reserved path characters such as %2F. */
export function seoPageComparisonKey(value: string) {
  return normalized(value).replace(/%[0-9a-f]{2}/gi, (escape) => {
    const character = String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    return /^[A-Za-z0-9._~-]$/.test(character)
      ? character
      : escape.toUpperCase();
  });
}

/** Discovery selects indexing evidence on the approved exact host, never additional full-audit pages. */
export function selectSeoRelatedPages(
  seedPageUrls: string[],
  relatedPageUrls: string[],
) {
  const seeds = seedPageUrls.map(normalized);
  if (
    !seeds.length ||
    new Set(seeds.map(seoPageComparisonKey)).size !== seeds.length
  )
    throw badRequest("The audit seed pages must be distinct");
  const host = new URL(seeds[0]!).host;
  for (const value of [...seeds, ...relatedPageUrls]) {
    const url = new URL(value);
    if (
      !isValidHttpUrl(value) ||
      url.username ||
      url.password ||
      url.host !== host
    )
      throw badRequest("Related pages must use the audit's exact public host");
  }
  const related = relatedPageUrls.map(normalized);
  for (const value of related) {
    const url = new URL(value);
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      throw badRequest("Related page URLs contain invalid encoding");
    }
    if (url.search !== "" || PRIVATE_PAGE.test(path) || FILE_PAGE.test(path))
      throw badRequest(
        "Related pages cannot be private, utility, query or file URLs",
      );
  }
  const unique = new Map<string, string>();
  for (const url of [...seeds, ...related]) {
    const key = seoPageComparisonKey(url);
    if (!unique.has(key)) unique.set(key, url);
  }
  const pageUrls = [...unique.values()];
  if (pageUrls.length > SEO_MAX_PAGES)
    throw badRequest("An indexing check can include at most ten pages");
  return pageUrls;
}

/** Indexing evidence metadata never changes the original Task packet, report scope or approved price. */
export function originalSeoAuditPacket(value: unknown) {
  const request = requestObject.parse(value);
  if (request.relatedIndexingSelection === undefined) return request;
  const selection = seoRelatedIndexingSelectionSchema.safeParse(
    request.relatedIndexingSelection,
  );
  if (
    !selection.success ||
    request.inspectRelated !== true ||
    JSON.stringify(request.pageUrls) !==
      JSON.stringify(selection.data.seedPageUrls)
  )
    throw conflict("The related indexing selection is invalid");
  selectSeoRelatedPages(
    selection.data.seedPageUrls,
    selection.data.relatedPageUrls,
  );
  const { relatedIndexingSelection: _selection, ...packet } = request;
  return packet;
}
