import { z } from "@hono/zod-openapi";
import {
  type AuditDiscovery,
  MAX_AUDIT_SITEMAPS,
  sitemapAddress,
} from "@/schemas/seo-sitemap-evidence.schema";
import { gscPropertyCovers } from "./native-gsc-property";
import { unwrapNativeStatistics } from "./native-statistics";

export const GSC_LIST_SITEMAPS = "GOOGLE_SEARCH_CONSOLE_LIST_SITEMAPS";
// The property read and at most three child-index reads share a fixed request bound.
const MAX_CHILD_INDEX_READS = 3;
const rawCount = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const googleTime = z.iso
  .datetime({ offset: true })
  .transform((s) => new Date(s).toISOString());
const sitemap = z.object({
  path: sitemapAddress,
  isSitemapsIndex: z.boolean().optional(),
  isPending: z.boolean().optional(),
  type: z.string().max(64).optional(),
  lastSubmitted: googleTime.optional(),
  lastDownloaded: googleTime.optional(),
  warnings: rawCount.optional(),
  errors: rawCount.optional(),
  contents: z
    .array(z.object({ type: z.string(), submitted: rawCount.optional() }))
    .max(16)
    .optional(),
});
type Inventory = Pick<AuditDiscovery, "status" | "sitemaps">;

/** URL Inspection lists examples Google associates with one URL. Both lists may be absent or incomplete. */
export function inspectionDiscoverySources(payload: Record<string, unknown>) {
  const result = z
    .object({
      inspectionResult: z.object({
        indexStatusResult: z.object({
          sitemap: z.unknown().optional(),
          referringUrls: z.unknown().optional(),
        }),
      }),
    })
    .safeParse(payload);
  const details = result.data?.inspectionResult.indexStatusResult;
  const urls = (value: unknown) =>
    Array.isArray(value)
      ? [
          ...new Set(
            value.filter(
              (u): u is string =>
                typeof u === "string" && sitemapAddress.safeParse(u).success,
            ),
          ),
        ].slice(0, 8)
      : undefined;
  const reportedSitemaps = urls(details?.sitemap),
    referringPages = urls(details?.referringUrls);
  return {
    ...(reportedSitemaps && { reportedSitemaps }),
    ...(referringPages && { referringPages }),
  };
}

export async function readSubmittedSitemaps(
  property: string,
  read: (args: Record<string, unknown>) => Promise<unknown>,
): Promise<Inventory> {
  const result: Inventory = { status: "available", sitemaps: [] };
  const seen = new Set<string>();
  const queue: (string | undefined)[] = [undefined];
  for (let i = 0; i < queue.length && i <= MAX_CHILD_INDEX_READS; i++) {
    const parent = queue[i];
    try {
      const raw = unwrapNativeStatistics(
        await read({
          site_url: property,
          ...(parent && { sitemap_index: parent }),
        }),
        ["sitemap"],
      );
      if (
        !Object.hasOwn(raw, "sitemap") &&
        Object.keys(raw).some((k) => k !== "kind")
      )
        throw new Error("Unrecognized sitemap list");
      const rows = z.array(z.unknown()).default([]).parse(raw.sitemap);
      for (const item of rows) {
        const parsed = sitemap.safeParse(item);
        if (!parsed.success) {
          result.status = "partial";
          continue;
        }
        const row = parsed.data;
        if (!gscPropertyCovers(property, [row.path])) {
          result.status = "partial";
          continue;
        }
        if (seen.has(row.path)) continue;
        if (result.sitemaps.length >= MAX_AUDIT_SITEMAPS) {
          result.status = "partial";
          break;
        }
        seen.add(row.path);
        if (row.isSitemapsIndex) queue.push(row.path);
        result.sitemaps.push({
          path: row.path,
          type: row.type ?? null,
          index: row.isSitemapsIndex ?? false,
          pending: row.isPending ?? null,
          submittedAt: row.lastSubmitted ?? null,
          downloadedAt: row.lastDownloaded ?? null,
          errors: row.errors ?? null,
          warnings: row.warnings ?? null,
          webUrls:
            row.contents?.find((c) => c.type === "web")?.submitted ?? null,
        });
      }
    } catch {
      result.status = parent ? "partial" : "unavailable";
    }
  }
  if (queue.length > MAX_CHILD_INDEX_READS + 1) result.status = "partial";
  return result;
}

export function discoveryChanges(
  current: AuditDiscovery,
  earlier: AuditDiscovery | undefined,
  oldest?: AuditDiscovery,
): AuditDiscovery["changes"] {
  const changes: AuditDiscovery["changes"] = [];
  if (
    !earlier ||
    earlier.checkedAt.slice(0, 10) >= current.checkedAt.slice(0, 10)
  )
    return changes;
  const previousDay = earlier.checkedAt.slice(0, 10);
  for (const row of current.sitemaps) {
    const old = earlier.sitemaps.find((r) => r.path === row.path);
    if (!old || row.pending || old.pending) continue;
    const parts: string[] = [];
    if (
      row.errors !== null &&
      old.errors !== null &&
      row.errors !== old.errors
    ) {
      parts.push(
        `Google reported ${old.errors} sitemap errors previously and ${row.errors} now.`,
      );
    }
    if (
      row.webUrls !== null &&
      old.webUrls !== null &&
      row.webUrls !== old.webUrls &&
      row.downloadedAt &&
      old.downloadedAt &&
      row.downloadedAt > old.downloadedAt
    ) {
      const first =
        oldest && oldest.checkedAt.slice(0, 10) < previousDay
          ? oldest.sitemaps.find(
              (r) =>
                r.path === row.path &&
                !r.pending &&
                r.downloadedAt &&
                r.downloadedAt < old.downloadedAt!,
            )
          : undefined;
      const counts =
        first?.webUrls != null &&
        Math.sign(old.webUrls - first.webUrls) ===
          Math.sign(row.webUrls - old.webUrls)
          ? [first.webUrls, old.webUrls, row.webUrls]
          : [old.webUrls, row.webUrls];
      parts.push(
        `Page URLs reported across ${counts.length} successive observed Google reads: ${counts.join(" → ")}. ${row.webUrls < old.webUrls ? "Check removed URLs against intended canonical pages." : "Inspect a sample of the added pages after Google crawls them."}`,
      );
    }
    if (parts.length)
      changes.push({ url: row.path, previousDay, text: parts.join(" ") });
  }
  for (const row of current.inspections) {
    const old = earlier.inspections.find((r) => r.page === row.page);
    if (
      !old ||
      !old.reason ||
      !row.reason ||
      old.reason === row.reason ||
      old.checkedAt.slice(0, 10) >= row.checkedAt.slice(0, 10) ||
      [row.verdict, old.verdict].includes("VERDICT_UNSPECIFIED")
    )
      continue;
    changes.push({
      url: row.page,
      previousDay: old.checkedAt.slice(0, 10),
      currentDay: row.checkedAt.slice(0, 10),
      text: `Google’s coverage reason changed from “${old.reason.slice(0, 200)}” to “${row.reason.slice(0, 200)}”.`,
    });
  }
  return changes;
}
