import { z } from "@hono/zod-openapi";

import { badRequest } from "@/helpers/error";
import {
  seoDeviceSchema,
  seoSeveritySchema,
  seoUrlSchema,
} from "@/schemas/project-seo.schema";
import type { PublicSeoPayload } from "./project-seo-report";

const text = z.string().max(20_000);
const distinct = <T>(values: T[]) => new Set(values).size === values.length;
const siteEvidence = z.object({
  snapshotId: text,
  selection: z.object({
    pages: z
      .array(z.object({ n: z.number().int().positive(), url: seoUrlSchema }))
      .max(10),
  }),
  siteFindings: z
    .array(
      z.object({
        id: text,
        row: text,
        name: text,
        level: seoSeveritySchema,
        devices: z.array(seoDeviceSchema).max(2).refine(distinct),
        evidence: z.array(text).max(100),
        pages: z.array(z.number().int().positive()).max(10).refine(distinct),
        findings: z.array(text).max(5000),
      }),
    )
    .max(5000),
});

/** Page findings already include merged site findings. Only checks performed across pages need extra rows. */
export function publicSiteFindings(
  raw: unknown,
  pageUrls: string[],
  observedAt: string,
): { findings: PublicSeoPayload["findings"]; notes: string[] } {
  if (!raw || typeof raw !== "object" || !("siteFindings" in raw))
    return { findings: [], notes: [] };
  const parsed = siteEvidence.safeParse(raw);
  if (!parsed.success)
    throw badRequest("The site findings or their page references are invalid");
  const data = parsed.data;
  const normalized = (url: string) => {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  };
  const allowed = new Set(pageUrls.map(normalized));
  const pages = new Map(data.selection.pages.map((page) => [page.n, page.url]));
  if (
    pages.size !== data.selection.pages.length ||
    !distinct(data.siteFindings.map((finding) => finding.id))
  )
    throw badRequest("The site findings contain duplicate identities");
  const notes: string[] = [];
  const findings = data.siteFindings.flatMap((finding) => {
    // Validate references even for merged findings, before leaving their existing page rows alone.
    const urls = finding.pages.map((n) => {
      const url = pages.get(n);
      if (!url || !allowed.has(normalized(url)))
        throw badRequest("The site finding names an unaudited page");
      return { n, url };
    });
    if (finding.findings.length) return [];
    // The worker uses an empty page list for site-wide checks such as lost link equity.
    // Anchor their display to the Audit's first page and explicitly retain their actual scope in the notes.
    const targets: Array<{ n: number | "site"; url: string }> = urls.length
      ? urls
      : [{ n: "site", url: pageUrls[0]! }];
    if (!urls.length)
      notes.push(
        `Site-wide finding ${finding.id} is shown under ${pageUrls[0]}; the worker assigned no audited page.`,
      );
    const devices = finding.devices.length ? finding.devices : [null];
    return targets.flatMap(({ n, url }) =>
      devices.map((device) => ({
        id: `site:${finding.id}:${n}:${device}`,
        rowId: finding.row,
        pageUrl: url,
        device,
        title: finding.name,
        severity: finding.level,
        evidence: finding.evidence,
        observedAt,
        sourceRef: `${data.snapshotId}:${finding.id}`,
      })),
    );
  });
  return { findings, notes };
}
