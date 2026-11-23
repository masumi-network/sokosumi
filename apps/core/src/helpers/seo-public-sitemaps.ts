import { z } from "@hono/zod-openapi";
import { isValidHttpUrl, publicExplorationUrl } from "@sokosumi/utils";

import { seoUrlSchema } from "@/schemas/seo-page.schema";
import { reportObject } from "./project-seo-public-report";

function publicSitemapUrl(value: string) {
  return (
    isValidHttpUrl(value) &&
    publicExplorationUrl(value) &&
    !/[?#]/.test(value) &&
    !/\.(?:local|localhost|internal|lan|home|arpa|invalid|onion)$/i.test(
      new URL(value).hostname,
    )
  );
}

export const publicSitemapList = z
  .array(seoUrlSchema.refine(publicSitemapUrl))
  .min(1)
  .max(3);

export function publicAuditRoots(
  value: unknown,
  page: string,
  finalHome?: string | null,
) {
  const roots = publicSitemapList.safeParse(value).data;
  if (!roots || !publicSitemapUrl(page)) return undefined;
  const start = new URL(page);
  const origins = new Set([start.origin]);
  if (start.pathname === "/") {
    const twin = new URL(page);
    twin.hostname = start.hostname.startsWith("www.")
      ? start.hostname.slice(4)
      : "www." + start.hostname;
    // Imports check the reported mobile final URL. Persisted roots passed this check on delivery.
    if (finalHome === undefined || finalHome === twin.href)
      origins.add(twin.origin);
  }
  if (!roots.every((url) => origins.has(new URL(url).origin))) return undefined;
  return [...new Set(roots)];
}

export function workerSitemaps(
  raw: unknown,
  result: {
    request: { url: string };
    header: { finalUrl?: { mobile?: string | null } };
  },
) {
  return publicAuditRoots(
    reportObject(raw)?.publicSitemaps,
    result.request.url,
    result.header.finalUrl?.mobile ?? null,
  );
}
