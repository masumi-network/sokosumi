import {
  isPublicSeoSitemapPage,
  isSeoUtilityOrFilePath,
  isValidHttpUrl,
} from "@sokosumi/utils";
import { z } from "zod";
import { badRequest, conflict } from "@/helpers/error";
import { publicExplorationUrl } from "@/helpers/project-seo-exploration-privacy";
import { gscPropertyCovers } from "@/lib/seo/native-gsc-property";
import { SEO_MAX_PAGES } from "@/schemas/project-seo.schema";
import {
  SEO_MAX_DEFERRED_LEADS,
  type SeoSiteEvidence,
} from "@/schemas/seo-site-evidence.schema";
import { seoAuditSearchConsoleAccessSchema } from "@/schemas/seo-task-indexing.schema";
import { seoRelatedIndexingSelectionSchema } from "@/schemas/seo-task-pages.schema";

const requestObject = z.record(z.string(), z.json());

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
  frozenAccess?: unknown,
  publicRedirectOrigin?: string,
) {
  const seeds = seedPageUrls.map(normalized);
  if (
    !seeds.length ||
    new Set(seeds.map(seoPageComparisonKey)).size !== seeds.length
  )
    throw badRequest("The audit seed pages must be distinct");
  const primary = new URL(seeds[0]!);
  const access = seoAuditSearchConsoleAccessSchema.safeParse(frozenAccess);
  const property = access.success ? access.data.propertyId : "";
  const domain = property.startsWith("sc-domain:")
    ? property.slice("sc-domain:".length).toLowerCase()
    : "";
  const candidates = [...seeds, ...relatedPageUrls];
  for (const [index, value] of candidates.entries()) {
    const url = new URL(value);
    // Only private related targets may use the www alias. Seeds retain their exact host.
    const propertyAlias =
      index >= seeds.length &&
      domain &&
      url.port === primary.port &&
      (url.protocol === primary.protocol ||
        (primary.protocol === "http:" && url.protocol === "https:")) &&
      ((primary.hostname === domain && url.hostname === "www." + domain) ||
        (url.hostname === domain && primary.hostname === "www." + domain)) &&
      gscPropertyCovers(property, [primary.href, url.href]);
    const alias =
      propertyAlias ||
      (index >= seeds.length && url.origin === publicRedirectOrigin);
    if (
      !isValidHttpUrl(value) ||
      url.username ||
      url.password ||
      (url.host !== primary.host && !alias)
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
    if (url.search !== "" || isSeoUtilityOrFilePath(path))
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

/** A recorded redirect can authorize a second public origin outside the Google inspection scope. */
export function publicSeoRedirectOrigin(
  seed: string,
  evidence: SeoSiteEvidence | undefined,
  access: unknown,
) {
  if (!evidence) return;
  const primary = new URL(seed);
  const alias = primary.hostname.startsWith("www.")
    ? primary.hostname.slice(4)
    : "www." + primary.hostname;
  const response = evidence.responses?.find(
    (entry) =>
      seoPageComparisonKey(entry.pageUrl) === seoPageComparisonKey(seed),
  );
  if (
    !response?.finalUrl ||
    ![301, 302, 303, 307, 308].includes(response.status)
  )
    return;
  const final = new URL(response.finalUrl);
  if (
    final.hostname === alias &&
    final.port === primary.port &&
    (final.protocol === primary.protocol ||
      (primary.protocol === "http:" && final.protocol === "https:"))
  ) {
    const proof = seoAuditSearchConsoleAccessSchema.safeParse(access);
    // A domain property already grants this alias the existing private inspection path.
    if (
      proof.success &&
      proof.data.propertyId.toLowerCase() ===
        "sc-domain:" + primary.hostname.replace(/^www\./, "")
    )
      return;
    return final.origin;
  }
}

export function requireSeoEvidenceUrl(
  value: string,
  primary: string,
  sitemap: boolean,
  access?: unknown,
  publicRedirectOrigin?: string,
) {
  const url = new URL(value);
  if (
    !publicExplorationUrl(value) ||
    /\.(?:local|localhost|internal|lan|home|arpa|invalid|onion)$/i.test(
      url.hostname,
    ) ||
    value.includes("#") ||
    value.includes("?") ||
    /%25|%2f|%5c/i.test(url.pathname)
  )
    throw badRequest(
      "Site evidence requires a public URL without query or fragment",
    );
  // Validate the full path against the private-page guard. Only a sitemap may end in XML.
  if (sitemap) url.pathname = url.pathname.replace(/\.xml(?:\.gz)?$/i, "");
  selectSeoRelatedPages([primary], [url.href], access, publicRedirectOrigin);
}

/** Validate detached public sources without granting them an inspection slot. */
export function validateSeoSiteEvidence(
  evidence: SeoSiteEvidence,
  selected: string[],
  access: unknown,
  publicRedirectOrigin?: string,
) {
  const selectedKeys = new Set(selected.map(seoPageComparisonKey));
  const donors = new Set(evidence.sampledPages.map(seoPageComparisonKey));
  const validated = new Set<string>();
  const checkUrl = (value: string, sitemap = false) => {
    const cacheKey = JSON.stringify([value, sitemap]);
    if (validated.has(cacheKey)) return;
    requireSeoEvidenceUrl(
      value,
      selected[0]!,
      sitemap,
      access,
      publicRedirectOrigin,
    );
    validated.add(cacheKey);
  };
  for (const url of selected) checkUrl(url);
  for (const url of evidence.sampledPages) checkUrl(url);
  if (donors.size !== evidence.sampledPages.length)
    throw badRequest("Sampled pages must be distinct");
  const checkTarget = (url: string) => {
    checkUrl(url);
    if (!selectedKeys.has(seoPageComparisonKey(url)))
      throw badRequest(
        "Evidence targets must belong to the approved selection",
      );
  };
  for (const observation of evidence.observations) {
    const sitemap = observation.sourceKind === "sitemap";
    checkUrl(observation.sourceUrl, sitemap);
    checkTarget(observation.targetUrl);
    if (
      sitemap !== (observation.location === "sitemap") ||
      (!sitemap && !donors.has(seoPageComparisonKey(observation.sourceUrl)))
    )
      throw badRequest("A link must name its sampled source and location");
  }
  const responded = new Set<string>();
  for (const response of evidence.responses ?? []) {
    checkTarget(response.pageUrl);
    const key = seoPageComparisonKey(response.pageUrl);
    if (responded.has(key))
      throw badRequest("Each response must name a distinct page");
    responded.add(key);
    if (
      response.sitemapEligible &&
      (response.status !== 200 ||
        response.finalUrl ||
        !donors.has(key) ||
        !isPublicSeoSitemapPage(response.pageUrl))
    )
      throw badRequest(
        "A draft sitemap entry requires a directly verified, sampled page",
      );
    if (response.declaredCanonical) {
      checkUrl(response.declaredCanonical);
      if (
        response.status !== 200 ||
        response.finalUrl ||
        response.sitemapEligible ||
        !donors.has(key) ||
        new URL(response.declaredCanonical).origin !==
          new URL(response.pageUrl).origin ||
        seoPageComparisonKey(response.declaredCanonical) === key
      )
        throw badRequest(
          "An alternate canonical requires a directly sampled page and a different same-origin URL",
        );
    }
    if (response.finalUrl) checkUrl(response.finalUrl);
  }
  if (evidence.coverage) {
    const { discovered, deferredCount, deferred } = evidence.coverage;
    if (
      deferredCount !== discovered - responded.size ||
      discovered < selectedKeys.size ||
      deferred.length !== Math.min(deferredCount, SEO_MAX_DEFERRED_LEADS)
    )
      throw badRequest(
        "Discovery counts must match the recorded responses and deferred sample",
      );
    const deferredKeys = new Set<string>();
    for (const lead of deferred) {
      checkUrl(lead.url);
      const key = seoPageComparisonKey(lead.url);
      if (deferredKeys.has(key) || responded.has(key))
        throw badRequest(
          "Deferred leads must be distinct from recorded responses",
        );
      deferredKeys.add(key);
    }
  }
}

/** Indexing evidence metadata never changes the original Task packet, report scope or approved price. */
export function originalSeoAuditPacket(value: unknown) {
  const {
    searchConsoleAccess: _access,
    fullAuditCost: _cost,
    pendingFullAuditCost: _pendingCost,
    fullAuditBillingContext: _billing,
    ...request
  } = requestObject.parse(value);
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
    _access,
  );
  const { relatedIndexingSelection: _selection, ...packet } = request;
  return packet;
}
