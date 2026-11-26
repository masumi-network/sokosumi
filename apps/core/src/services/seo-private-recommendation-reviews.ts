import prisma from "@/lib/db/prisma";
import type { SeoActor, SeoWorkspaceQuery } from "@/schemas/project-seo.schema";
import type { PublicSeoDecision } from "@/schemas/project-seo-action.schema";
import { nativeSeoMetricsSchema } from "@/schemas/project-seo-native-metrics.schema";
import { seoBriefContent } from "@/schemas/seo-audit-brief.schema";
import { privateLandingOutcomeSchema } from "@/schemas/seo-landing-outcomes.schema";
import {
  matchesSeoPeriod,
  SEO_RESULT_LIMIT,
  seoOwnerWhere,
} from "./project-seo-store";
import { currentBrief } from "./seo-audit-brief.service";
import { SEO_LANDING_OUTCOMES_KIND } from "./seo-brief-landing-outcomes";
import {
  connectionVersion,
  resolveSeoStatisticsIntegration,
} from "./seo-connections.service";
import { completeLandingWindow } from "./seo-landing-engagement";
import { landingOutcomeAccountKey } from "./seo-statistics-landing";

type Metric =
  | "engagement_changed"
  | "purchase_rate_changed"
  | "signup_rate_changed";
type Sample = {
  id: string;
  from: string;
  to: string;
  at: Date;
  dataset: string;
  zone: string;
  sessions: number;
  engagement: number;
  purchases?: number;
  signups?: number;
};
const DAY = 86_400_000;
const WEEK = 7;
const MIN_SESSIONS = 30;
const MIN_EVENTS = 5;
const RELATIVE_CHANGE = 0.25;
const MIN_SECONDS = 10;
const MIN_EVENTS_PER_HUNDRED = 1;

function rate(sample: Sample, kind: Metric) {
  if (kind === "engagement_changed") return sample.engagement / sample.sessions;
  const count =
    kind === "purchase_rate_changed" ? sample.purchases : sample.signups;
  return count === undefined ? undefined : (100 * count) / sample.sessions;
}

const windowDays = (w: Sample) =>
  (Date.parse(w.to) - Date.parse(w.from)) / DAY + 1;
function comparable(a: Sample, b: Sample) {
  const days = windowDays(a);
  return (
    a.dataset === b.dataset &&
    days === windowDays(b) &&
    (days % WEEK === 0 ||
      new Date(a.from).getUTCDay() === new Date(b.from).getUTCDay())
  );
}
const period = (s: Sample) => ({
  from: s.from,
  to: s.to,
  sessions: s.sessions,
});

/** Pin the baseline to the action's day, then retain the first period of each continuous material change. */
export function privateMetricEpisode(
  samples: Sample[],
  kind: Metric,
  anchor: Date,
  query: SeoWorkspaceQuery,
) {
  const latest = samples.at(-1);
  if (!latest) return;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: latest.zone,
  }).format(anchor);
  if (latest.from <= day || latest.sessions < MIN_SESSIONS) return;
  const earlier = samples.findLast((s) => s.to < day && comparable(s, latest));
  if (
    !earlier ||
    earlier.sessions < MIN_SESSIONS ||
    Date.parse(day) - Date.parse(earlier.to) > windowDays(earlier) * DAY
  )
    return;
  const before = rate(earlier, kind);
  if (before === undefined) return;
  const minDelta =
    kind === "engagement_changed" ? MIN_SECONDS : MIN_EVENTS_PER_HUNDRED;
  let episode: Sample | undefined;
  let direction = 0;
  for (const s of samples) {
    if (s.from <= day || !comparable(earlier, s)) continue;
    const after = rate(s, kind);
    if (after === undefined || s.sessions < MIN_SESSIONS) continue;
    const hasEvents =
      kind === "engagement_changed" ||
      Math.max(
        kind === "purchase_rate_changed"
          ? (s.purchases ?? 0)
          : (s.signups ?? 0),
        kind === "purchase_rate_changed"
          ? (earlier.purchases ?? 0)
          : (earlier.signups ?? 0),
      ) >= MIN_EVENTS;
    const delta = after - before;
    const next =
      hasEvents &&
      Math.abs(delta) >= Math.max(minDelta, before * RELATIVE_CHANGE)
        ? Math.sign(delta)
        : 0;
    if (next !== direction) episode = next ? s : undefined;
    direction = next;
  }
  if (
    rate(latest, kind) === undefined ||
    !episode ||
    !matchesSeoPeriod(episode.at, query)
  )
    return;
  return {
    kind,
    before,
    after: rate(episode, kind)!,
    baselineObservationId: earlier.id,
    baselineObservedAt: earlier.at.toISOString(),
    observationId: episode.id,
    observedAt: episode.at.toISOString(),
    beforePeriod: period(earlier),
    afterPeriod: period(episode),
  };
}

export async function loadPrivateRecommendationReviews(
  actor: SeoActor,
  pages: { id: string; url: string }[],
  query: SeoWorkspaceQuery,
) {
  if (actor.sokoBotId || !pages.length || query.channel === "ai_assistant")
    return;
  const where = {
    ...seoOwnerWhere(actor),
    ownerId: actor.userId,
    source: "ga4",
    pageIds: { hasSome: pages.map((p) => p.id) },
    observedAt: {
      lte: query.to
        ? new Date(
            Math.min(Date.now(), Date.parse(query.to + "T23:59:59.999Z")),
          )
        : new Date(),
    },
  };
  const metrics = await prisma.projectSeoObservation.findMany({
    where: { ...where, kind: "metrics" },
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: SEO_RESULT_LIMIT,
    select: { id: true, observedAt: true, pageIds: true, payload: true },
  });
  if (!metrics.length) return;
  // Multiple inherited accounts cannot establish which receipts belong to the selected account.
  const account = await resolveSeoStatisticsIntegration(actor, "ga4").catch(
    (err: unknown) => {
      if (
        typeof err === "object" &&
        err &&
        "status" in err &&
        (err.status === 403 || err.status === 404 || err.status === 409)
      )
        return null;
      throw err;
    },
  );
  if (!account) return;
  const [brief, outcomeRows] = await Promise.all([
    currentBrief(actor, prisma),
    prisma.projectSeoObservation.findMany({
      where: {
        ...where,
        kind: SEO_LANDING_OUTCOMES_KIND,
        visibility: "PRIVATE",
        OR: metrics.map((m) => ({
          payload: { path: ["metricObservationId"], equals: m.id },
        })),
      },
      select: { payload: true },
    }),
  ]);
  const accountKey = landingOutcomeAccountKey(account);
  const outcomes = new Map<
    string,
    NonNullable<
      ReturnType<typeof privateLandingOutcomeSchema.safeParse>["data"]
    > | null
  >();
  for (const row of outcomeRows) {
    const data = privateLandingOutcomeSchema.safeParse(row.payload).data;
    if (!data?.metricObservationId || data.accountKey !== accountKey) continue;
    const prior = outcomes.get(data.metricObservationId);
    // Ambiguous named events must never be attributed to a recommendation.
    outcomes.set(
      data.metricObservationId,
      prior !== undefined && JSON.stringify(prior) !== JSON.stringify(data)
        ? null
        : data,
    );
  }
  const goals = seoBriefContent.safeParse(brief?.payload).data?.pages;
  const version = connectionVersion(account);
  const available = new Map<
    string,
    { samples: Sample[]; goal?: string | null }
  >();
  const parsed = metrics.map((row) => ({
    row,
    data: nativeSeoMetricsSchema.safeParse(row.payload).data,
  }));
  for (const page of pages) {
    const rows = parsed.filter(({ row }) => row.pageIds.includes(page.id));
    const selected = rows[0]?.data;
    if (
      !selected ||
      selected.landingEngagementEvidence?.connectionVersion !== version ||
      !selected.landingPages?.verifiedHost
    )
      continue;
    const series = new Map<string, Sample>();
    const revised = new Set<string>();
    for (const { row, data } of rows) {
      if (
        !data ||
        data.propertyId !== selected.propertyId ||
        data.timeZone !== selected.timeZone ||
        data.landingEngagementEvidence?.connectionVersion !== version
      )
        break;
      const window = completeLandingWindow({
        id: row.id,
        ownerId: actor.userId,
        data,
      });
      const landing = window?.rows.get(page.url);
      // If the most recently selected source is incomplete, do not surface a superseded signal.
      if (!landing) {
        if (row === rows[0]?.row) break;
        continue;
      }
      const receipt = outcomes.get(row.id);
      const counts =
        receipt &&
        receipt.propertyId === data.propertyId &&
        receipt.verifiedHost === data.landingPages?.verifiedHost &&
        receipt.from === data.from &&
        receipt.to === data.to &&
        receipt.timeZone === data.timeZone
          ? receipt.rows.filter((r) => r.pageUrl === page.url)
          : [];
      const sample: Sample = {
        id: row.id,
        at: new Date(data.collectedAt ?? data.observedAt),
        from: data.from,
        to: data.to,
        zone: data.timeZone,
        dataset: JSON.stringify([version, data.propertyId, data.timeZone]),
        sessions: landing.sessions,
        engagement: landing.engagementSeconds,
        purchases: counts.find((r) => r.event === "purchase")?.count,
        signups: counts.find((r) => r.event === "sign_up")?.count,
      };
      const key = data.from + ":" + data.to;
      const existing = series.get(key);
      // Repeat selections and unchanged fresh reads are the same measurement. A real revision stops this search.
      if (!existing) series.set(key, sample);
      else if (!revised.has(key)) {
        const sameValues =
          existing.sessions === sample.sessions &&
          existing.engagement === sample.engagement &&
          existing.purchases === sample.purchases &&
          existing.signups === sample.signups;
        if (sample.at.getTime() === existing.at.getTime() || sameValues)
          series.set(key, sample);
        else revised.add(key);
      }
    }
    const samples = [...series.values()].sort(
      (a, b) => a.to.localeCompare(b.to) || a.from.localeCompare(b.from),
    );
    if (samples.length >= 2)
      available.set(page.url, {
        samples,
        goal: goals?.find((g) => g.pageId === page.id)?.action,
      });
  }
  const candidates = new Map<
    string,
    NonNullable<ReturnType<typeof privateMetricEpisode>>
  >();
  return {
    candidates,
    measure(decision: PublicSeoDecision, anchor: Date) {
      const site = available.get(decision.targetUrl);
      if (
        !site ||
        !["content_opportunity", "offer_availability"].includes(decision.kind)
      )
        return;
      const kind =
        site.goal === "buy"
          ? "purchase_rate_changed"
          : site.goal === "sign up"
            ? "signup_rate_changed"
            : decision.kind === "content_opportunity" &&
                (!site.goal || site.goal === "read")
              ? "engagement_changed"
              : undefined;
      if (kind) return privateMetricEpisode(site.samples, kind, anchor, query);
    },
  };
}
export type PrivateRecommendationReviews = Awaited<
  ReturnType<typeof loadPrivateRecommendationReviews>
>;
