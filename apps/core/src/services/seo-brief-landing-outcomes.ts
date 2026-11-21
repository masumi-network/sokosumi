import type { Prisma } from "@sokosumi/database";
import type { SeoActor } from "@/schemas/project-seo.schema";
import type {
  SeoBriefContent,
  SeoBriefFollowUp,
} from "@/schemas/seo-audit-brief.schema";
import {
  privateLandingOutcomeSchema,
  privateLandingSourceSchema,
  type SeoBriefOutcome,
  type SeoGoalInvestigation,
  seoLandingEvents,
} from "@/schemas/seo-landing-outcomes.schema";
import { SEO_RESULT_LIMIT, seoOwnerWhere } from "./project-seo-store";

export const SEO_LANDING_OUTCOMES_KIND = "landing_outcomes";
type Window = SeoBriefOutcome["latest"];
type ObservedWindow = Window & {
  dataset: string;
  zone: string | null;
  collectedAt: Date;
};
export type SalesSignal = { selection: string; count: number };
type Histories = Map<string, Map<string, ObservedWindow>>;
const DAY_MS = 86_400_000;

function propertyDay(at: Date, zone: string | null) {
  if (!zone) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(at);
  } catch {
    return null;
  }
}
const windowOnly = ({ from, to, count }: Window): Window => ({
  from,
  to,
  count,
});

/** Never compare across GA4 properties, connection revisions, reporting zones or the day work shipped. */
export function landingOutcome(
  event: SeoBriefOutcome["event"],
  history: ObservedWindow[],
  changedAt: string | null,
): SeoBriefOutcome | undefined {
  const newest = history[0];
  if (!newest) return undefined;
  // Rows arrive by collection time. Re-reading an older period must not replace a later measurement.
  const compatible = history.filter((r) => r.dataset === newest.dataset);
  const latest = compatible.reduce((a, b) =>
    b.to > a.to || (a.to === b.to && b.from > a.from) ? b : a,
  );
  const result: SeoBriefOutcome = { event, latest: windowOnly(latest) };
  const day = changedAt && propertyDay(new Date(changedAt), newest.zone);
  if (!day) return result;
  const before = new Map<string, ObservedWindow>(),
    after = new Map<string, ObservedWindow>();
  for (const r of compatible) {
    const collectedDay = propertyDay(r.collectedAt, r.zone);
    if (!collectedDay || r.to >= collectedDay) continue;
    const days = (Date.parse(r.to) - Date.parse(r.from)) / DAY_MS + 1;
    // Whole weeks have the same weekday mix regardless of their start day.
    const key = JSON.stringify([
      days,
      days % 7 ? new Date(r.from).getUTCDay() : null,
    ]);
    if (r.to < day && (!before.has(key) || r.to > before.get(key)!.to))
      before.set(key, r);
    if (r.from > day && (!after.has(key) || r.from < after.get(key)!.from))
      after.set(key, r);
  }
  let shortestGap = Infinity;
  for (const [key, earlier] of before) {
    const later = after.get(key);
    if (!later) continue;
    const gap = Date.parse(later.from) - Date.parse(earlier.to);
    if (gap < shortestGap) {
      result.comparison = {
        before: windowOnly(earlier),
        after: windowOnly(later),
      };
      shortestGap = gap;
    }
  }
  return result;
}

export async function briefNamedOutcomes(
  actor: SeoActor,
  pages: { id: string; url: string }[],
  goals: SeoBriefContent["pages"],
  followUps: SeoBriefFollowUp[],
  client: Prisma.TransactionClient,
) {
  const byUrl = new Map(pages.map((p) => [p.url, p.id]));
  const histories: Histories = new Map();
  const activeSource = new Map<string, string>();
  const currentDataset = new Map<string, string>();
  const controls = new Map<string, SeoGoalInvestigation>();
  const sales = new Map<string, SalesSignal>();
  if (!pages.length)
    return {
      followUps: followUps.map((follow) => ({ ...follow, outcomes: [] })),
      sales,
    };
  // Use the same bounded history as other SEO projections. Older, unseen periods never contribute a zero.
  const records = await client.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(actor),
      ownerId: actor.userId,
      visibility: "PRIVATE",
      kind: SEO_LANDING_OUTCOMES_KIND,
      source: "ga4",
      pageIds: { hasSome: pages.map((p) => p.id) },
    },
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: SEO_RESULT_LIMIT,
    select: { id: true, pageIds: true, observedAt: true, payload: true },
  });
  for (const record of records) {
    const parsed = privateLandingOutcomeSchema.safeParse(record.payload);
    const source = parsed.success
      ? parsed.data
      : privateLandingSourceSchema.safeParse(record.payload).data;
    if (!source) continue;
    const sourceKey = JSON.stringify([source.accountKey, source.propertyId]);
    for (const id of record.pageIds)
      if (!activeSource.has(id)) activeSource.set(id, sourceKey);
    if (!parsed.success) continue;
    const {
      accountKey,
      propertyId,
      from,
      to,
      timeZone: zone,
      verifiedHost,
      rows,
    } = parsed.data;
    const dataset = JSON.stringify([
      accountKey,
      propertyId,
      verifiedHost,
      zone,
    ]);
    const control = parsed.data.goalInvestigation;
    const urls = new Set(rows.map((row) => row.pageUrl));
    if (control) urls.add(control.pageUrl);
    for (const url of urls)
      if (
        activeSource.get(byUrl.get(url) ?? "") === sourceKey &&
        !currentDataset.has(url)
      )
        currentDataset.set(url, dataset);
    if (control && currentDataset.get(control.pageUrl) === dataset) {
      const prior = controls.get(control.pageUrl);
      if (!prior || prior.after.to < control.after.to)
        controls.set(control.pageUrl, control);
    }
    for (const row of rows) {
      const pageId = byUrl.get(row.pageUrl);
      if (!pageId || currentDataset.get(row.pageUrl) !== dataset) continue;
      const identity = JSON.stringify([pageId, row.event]);
      const windows =
        histories.get(identity) ?? new Map<string, ObservedWindow>();
      const key = JSON.stringify([dataset, from, to]);
      if (!windows.has(key))
        windows.set(key, {
          dataset,
          zone,
          from,
          to,
          count: row.count,
          collectedAt: record.observedAt,
        });
      histories.set(identity, windows);
    }
  }
  const enriched = followUps.map((follow) => {
    const action = goals.find((g) => g.pageId === follow.pageId)?.action;
    const page = pages.find((p) => p.id === follow.pageId);
    let latestClosedGoal: SeoBriefFollowUp["latestClosedGoal"];
    const outcomes = seoLandingEvents.flatMap((event) => {
      const windows = [
        ...(histories.get(JSON.stringify([follow.pageId, event]))?.values() ??
          []),
      ];
      const outcome = landingOutcome(event, windows, follow.changedAt);
      if (!outcome) return [];
      if (
        (action === "buy" && event === "purchase") ||
        (action === "sign up" && event === "sign_up")
      ) {
        for (const window of windows) {
          if (
            !page ||
            window.dataset !== currentDataset.get(page.url) ||
            !window.zone
          )
            continue;
          const day = propertyDay(window.collectedAt, window.zone);
          if (
            day &&
            window.to < day &&
            (!latestClosedGoal ||
              window.to > latestClosedGoal.to ||
              (window.to === latestClosedGoal.to &&
                window.from > latestClosedGoal.from))
          )
            latestClosedGoal = {
              ...windowOnly(window),
              event,
              timeZone: window.zone,
            };
        }
        const { from, to, count } = outcome.latest;
        const first = windows[0]!;
        const measured = windows.find(
          (row) =>
            row.dataset === first.dataset && row.from === from && row.to === to,
        );
        const collectedDay =
          measured && propertyDay(measured.collectedAt, measured.zone);
        if (collectedDay && to < collectedDay)
          sales.set(follow.pageId, {
            selection: JSON.stringify([event, first.dataset, from, to]),
            count,
          });
      }
      return [outcome];
    });
    const control = page && controls.get(page.url);
    const expected =
      action === "buy" ? "purchase" : action === "sign up" ? "sign_up" : null;
    return {
      ...follow,
      outcomes,
      ...(latestClosedGoal && { latestClosedGoal }),
      ...(control &&
        control.event === expected && { goalInvestigation: control }),
    };
  });
  return { followUps: enriched, sales };
}
