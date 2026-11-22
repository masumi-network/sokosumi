import { z } from "@hono/zod-openapi";
import {
  SEO_AUDIT_PLAN_LIMITS as limits,
  type SeoAuditPlan,
  seoAuditPlanKinds,
  seoAuditPlanMonth,
  seoAuditPlanSchema,
} from "@/schemas/seo-audit-plan.schema";
import { seoUrlSchema } from "@/schemas/seo-page.schema";
import { reportObject } from "./project-seo-public-report";
import type { PublicSeoPayload } from "./project-seo-report";
import { auditedSeoPageKey } from "./project-seo-site-findings";

// The SEO worker's plan (seo-bot audit-recommendation.ts): the first step is flat, the later steps are in nextSteps.
// A model wrote the text, so a part that is optional and not readable is left out, and never fails the import.
const words = (max: number) => z.string().trim().min(1).max(max);
const part = <T extends z.ZodType>(schema: T) =>
  schema.optional().catch(undefined);
const MAX_LINKS = 3;
const workerStep = z.object({
  pageUrl: part(seoUrlSchema),
  kind: part(z.enum(seoAuditPlanKinds)),
  action: words(limits.action),
  why: words(limits.why),
  nextCheck: words(limits.nextCheck),
  order: part(words(limits.order)),
  queries: part(z.array(words(limits.phrase)).max(limits.queries)),
  ideas: part(z.array(words(limits.phrase)).max(limits.ideas)),
  wording: part(words(limits.wording)),
  window: part(seoAuditPlanMonth),
  /** One link is one action: the page's action that cites one of these findings of the page. */
  links: part(
    z
      .array(
        z.object({
          pageUrl: seoUrlSchema,
          findings: z.array(z.string().min(1).max(200)).min(1).max(50),
        }),
      )
      .max(MAX_LINKS),
  ),
});
const workerPlan = workerStep.extend({
  summary: part(words(limits.summary)),
  strategy: part(words(limits.strategy)),
  nextSteps: part(z.array(z.unknown())),
  alternative: part(
    z.object({ option: words(limits.option), whyNot: words(limits.option) }),
  ),
  revisit: part(words(limits.revisit)),
  source: part(z.string().max(limits.source)),
});
const defined = <T extends Record<string, unknown>>(row: T) =>
  Object.fromEntries(
    Object.entries(row).filter(
      ([, value]) =>
        value !== undefined && !(Array.isArray(value) && !value.length),
    ),
  );

/**
 * The worker's plan for a full audit, bound to the audit's own pages and actions. A step keeps a page only when the
 * audit holds it, and an action only when the payload holds one for the cited findings. No plan when the first
 * step is not readable or names no audited page; the steps end before the first later step that is not readable.
 */
export function readAuditPlan(
  raw: unknown,
  payload: Pick<PublicSeoPayload, "kind" | "pageUrls" | "actions">,
): SeoAuditPlan | undefined {
  const report = reportObject(raw);
  const lead = workerPlan.safeParse(report?.recommendedPlan);
  if (!report || payload.kind !== "audit_full" || !lead.success) return;
  const audited = new Map(
    payload.pageUrls.map((url) => [auditedSeoPageKey(url), url]),
  );
  // A site report prefixes the ids of each page's findings and actions with the page's index.
  const prefixes = new Map<string, string>();
  if (report.kind !== "site")
    prefixes.set(auditedSeoPageKey(payload.pageUrls[0]!), "");
  else if (Array.isArray(report.pages))
    report.pages.forEach((page, index) => {
      const child = reportObject(page);
      const url = child?.kind !== "site" && reportObject(child?.request)?.url;
      if (typeof url === "string" && URL.canParse(url))
        prefixes.set(auditedSeoPageKey(url), `${index}:`);
    });
  const step = (row: z.infer<typeof workerStep>) => {
    const { links, pageUrl, ...text } = row;
    const actionIds: string[] = [];
    for (const link of links ?? []) {
      const prefix = prefixes.get(auditedSeoPageKey(link.pageUrl));
      if (prefix === undefined) continue;
      // The prefix names the page. A stored finding id ends with its device ("0:AC-05:mobile").
      const cited = new Set(link.findings.map((id) => prefix + id));
      const action = payload.actions.find((item) =>
        item.findingIds.some((id) =>
          cited.has(id.slice(0, id.lastIndexOf(":"))),
        ),
      );
      if (action && !actionIds.includes(action.id)) actionIds.push(action.id);
    }
    return {
      ...defined(text),
      ...(pageUrl &&
        audited.has(auditedSeoPageKey(pageUrl)) && {
          pageUrl: audited.get(auditedSeoPageKey(pageUrl)),
        }),
      actionIds,
    };
  };
  const {
    nextSteps,
    summary,
    strategy,
    alternative,
    revisit,
    source,
    ...first
  } = lead.data;
  if (!first.pageUrl || !audited.has(auditedSeoPageKey(first.pageUrl))) return;
  const steps = [step(first)];
  for (const next of nextSteps ?? []) {
    const parsed = workerStep.safeParse(next);
    if (!parsed.success || steps.length === limits.steps) break;
    steps.push(step(parsed.data));
  }
  const plan = seoAuditPlanSchema.safeParse({
    ...defined({ summary, strategy, alternative, revisit, source }),
    steps,
  });
  return plan.success ? plan.data : undefined;
}

/** The stored plan for a view: only when the view holds every page the plan's steps name. */
export function scopedAuditPlan(
  stored: unknown,
  inView: (url: string) => boolean,
): SeoAuditPlan | undefined {
  const plan = seoAuditPlanSchema.safeParse(stored);
  if (!plan.success) return;
  return plan.data.steps.every((row) => !row.pageUrl || inView(row.pageUrl))
    ? plan.data
    : undefined;
}
