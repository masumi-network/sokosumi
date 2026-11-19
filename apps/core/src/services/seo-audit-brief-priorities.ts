import type { Prisma } from "@sokosumi/database";
import { seoVisibilityFor } from "@/lib/seo/data-visibility";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { nativeSeoMetricsSchema } from "@/schemas/project-seo-native-metrics.schema";
import type {
  SeoAuditBrief,
  SeoBriefContent,
  SeoBriefFollowUp,
} from "@/schemas/seo-audit-brief.schema";
import { seoOwnerWhere } from "./project-seo-store";

import type { SalesSignal } from "./seo-brief-landing-outcomes";

type Page = SeoBriefContent["pages"][number];
type ObservedLanding = {
  sessions: number;
  keyEvents: number;
  from: string;
  to: string;
};
const priorityTier = {
  indexingConflict: 0,
  goalDecline: 1,
  routine: 2,
  pendingCrawl: 3,
  excluded: 4,
} as const;
type GoalControl = NonNullable<SeoBriefFollowUp["goalInvestigation"]>;
/** Only a decline names a next step. A held goal stays routine. */
const goalDeclineStep: Partial<Record<GoalControl["assessment"], string>> = {
  organic_declined:
    "The organic goal rate fell by at least 20% and the direct rate did not. Compare the queries, devices and countries in Search Console for the same two periods before testing page copy.",
  both_declined:
    "Organic and direct goal rates both fell. Check the completion step and compare GA4 tracking with confirmed records before changing search content.",
};
const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`;
function goalEvidence({ event, before, after }: GoalControl) {
  const channel = (name: string, key: "organic" | "direct") =>
    `${name} ${percent(before[key].rate)} of ${before[key].sessions} sessions from ${before.from} to ${before.to}, then ${percent(after[key].rate)} of ${after[key].sessions} sessions from ${after.from} to ${after.to}`;
  return `GA4 ${event} rate: ${channel("organic search", "organic")}; ${channel("direct", "direct")}.`;
}
const salesActions = new Set<Page["action"]>([
  "buy",
  "book",
  "sign up",
  "subscribe",
  "contact sales",
  "call",
  "download",
]);

export async function briefLandingEvidence(
  actor: SeoActor,
  pages: { id: string; url: string }[],
  client: Prisma.TransactionClient,
): Promise<Map<string, ObservedLanding>> {
  const observed = new Map<string, ObservedLanding>();
  if (!pages.length) return observed;
  // Compare pages only within a single complete read, with one property, period and channel.
  const metric = await client.projectSeoObservation.findFirst({
    where: {
      ...seoOwnerWhere(actor),
      kind: "metrics",
      source: "ga4",
      visibility: seoVisibilityFor(actor),
      ownerId: actor.organizationId ? { not: null } : actor.userId,
      pageIds: { hasEvery: pages.map((page) => page.id) },
      payload: { path: ["landingPages", "channel"], equals: "organic" },
    },
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { payload: true },
  });
  const parsed = nativeSeoMetricsSchema.safeParse(metric?.payload);
  if (
    !parsed.success ||
    parsed.data.provider !== "ga4" ||
    parsed.data.coverage !== "complete"
  )
    return observed;
  const { landingPages, from, to, pageUrls } = parsed.data;
  if (
    !landingPages?.verifiedHost ||
    landingPages.truncated ||
    pageUrls.some((url) => new URL(url).hostname !== landingPages.verifiedHost)
  )
    return observed;
  for (const page of pages) {
    const row = landingPages.rows.find((item) => item.pageUrl === page.url);
    if (
      row &&
      !landingPages.skippedUrls?.includes(page.url) &&
      pageUrls.includes(page.url)
    ) {
      observed.set(page.id, {
        sessions: row.sessions,
        keyEvents: row.keyEvents,
        from,
        to,
      });
    }
  }
  return observed;
}

function fitsObjective(page: Page, objective: SeoBriefContent["objective"]) {
  if (objective === "sales")
    return (
      salesActions.has(page.action) ||
      page.role === "pricing" ||
      page.role === "product"
    );
  if (objective === "support")
    return page.role === "support" || page.role === "guide";
  if (objective === "traffic")
    return page.indexIntent === "index" && page.action !== "none";
  return false;
}

export function briefPriorities(
  content: SeoBriefContent,
  followUps: SeoBriefFollowUp[],
  evidence: ReadonlyMap<string, ObservedLanding>,
  sales: ReadonlyMap<string, SalesSignal> = new Map(),
): SeoAuditBrief["priorities"] {
  const salePages = content.pages.filter((p) => fitsObjective(p, "sales"));
  const comparableSales =
    salePages.length > 1 &&
    salePages.every((p) => sales.has(p.pageId)) &&
    new Set([...sales.values()].map((s) => s.selection)).size === 1;
  const rows = content.pages.map((p) => {
    const follow = followUps.find((item) => item.pageId === p.pageId);
    const landing = evidence.get(p.pageId);
    const control = follow?.goalInvestigation;
    const declineStep = control && goalDeclineStep[control.assessment];
    const fits = fitsObjective(p, content.objective);
    const why: string[] = [];
    let nextStep = "";
    let tier: number = priorityTier.routine;
    if (follow?.indexReview === "review_indexing") {
      tier = priorityTier.indexingConflict;
      why.push(
        "The owner wants this URL indexed. The recorded Search Console verdict requires review.",
      );
      nextStep =
        "Inspect the URL's index status and canonical before editing its content.";
    } else if (follow?.indexReview === "review_exclusion") {
      tier = priorityTier.indexingConflict;
      why.push(
        "The owner wants this URL excluded. The recorded Search Console verdict was PASS.",
      );
      nextStep =
        "Review how the page signals exclusion and confirm what Google indexed.";
    } else if (p.indexIntent === "exclude") {
      tier = priorityTier.excluded;
      why.push("The owner wants this URL excluded from search.");
      nextStep =
        "Keep the intended exclusion when reviewing recommendations for this URL.";
    } else if (follow?.status === "awaiting_recrawl") {
      tier = priorityTier.pendingCrawl;
      why.push("The recorded change followed Google's last observed crawl.");
      nextStep =
        "Recheck the URL after a later Google crawl before reassessing that change.";
    } else if (declineStep) {
      tier = priorityTier.goalDecline;
      nextStep = declineStep;
      if (control?.weekdayMix === "uneven")
        nextStep +=
          " These periods include different numbers of some weekdays. Check the pattern by weekday before acting.";
    }
    if (control) why.push(goalEvidence(control));
    if (p.job) {
      const job = `Check whether the page helps visitors complete this job. ${p.job}`;
      nextStep = nextStep ? `${nextStep} ${job}` : job;
    } else if (!nextStep) {
      nextStep =
        "Confirm what visitors need to do on this page before choosing an edit.";
    }
    if (content.outcome && tier === priorityTier.routine)
      nextStep += ` Use the owner's stated outcome to assess the change. ${content.outcome}`;
    if (fits && content.objective)
      why.push(
        `The page's stated role or action fits the owner's ${content.objective} objective.`,
      );
    if (landing)
      why.push(
        `Organic search landings recorded ${landing.sessions} sessions and ${landing.keyEvents} GA4 key events from ${landing.from} to ${landing.to}.`,
      );
    for (const outcome of follow?.outcomes ?? []) {
      const { from, to, count } = outcome.latest;
      why.push(
        `GA4 recorded ${count} ${outcome.event} events for organic sessions landing on this page from ${from} to ${to}.`,
      );
    }
    if (!why.length)
      why.push(
        "This page is in the owner's brief. Its priority has limited evidence.",
      );
    const metric =
      content.objective === "sales"
        ? comparableSales
          ? sales.get(p.pageId)?.count
          : undefined
        : content.objective === "traffic"
          ? landing?.sessions
          : undefined;
    return {
      tier,
      fits,
      metric,
      priority: { pageId: p.pageId, nextStep, why },
    };
  });
  return rows
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        Number(b.fits) - Number(a.fits) ||
        Number(b.metric !== undefined) - Number(a.metric !== undefined) ||
        (b.metric ?? 0) - (a.metric ?? 0),
    )
    .map((row) => row.priority);
}
