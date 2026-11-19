import prisma from "@/lib/db/prisma";
import {
  ga4ReportSchema,
  type NativeStatisticsQuery,
  previousSeoPeriod,
  unwrapNativeStatistics,
} from "@/lib/seo/native-statistics";
import type { SeoActor } from "@/schemas/project-seo.schema";
import type { SeoLandingPages } from "@/schemas/project-seo-traffic.schema";
import { seoBriefContent } from "@/schemas/seo-audit-brief.schema";
import type { SeoGoalInvestigation } from "@/schemas/seo-landing-outcomes.schema";
import { currentBrief } from "./seo-audit-brief.service";

const LANDING = "landingPagePlusQueryString";
const CHANNEL = "sessionDefaultChannelGroup";
const CHANNELS = ["Organic Search", "Direct"];
// Screens determine whether to spend two quota reads. They do not establish statistical significance.
const MIN_SESSIONS = 20;
const MIN_BASELINE_EVENTS = 5;
const MIN_RELATIVE_DECLINE = 0.2;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const MIN_NON_WEEKLY_DURATION = 12 * WEEK_MS;
type Period = Pick<NativeStatisticsQuery, "from" | "to">;

function decreased(before: number, after: number) {
  return before > 0 && after <= before * (1 - MIN_RELATIVE_DECLINE);
}
type ReadReport = (args: Record<string, unknown>) => Promise<unknown>;
async function readGoalPeriod(
  read: ReadReport,
  property: string,
  period: Period,
  pageUrl: string,
  event: SeoGoalInvestigation["event"],
  zone: string,
  sessions: number,
) {
  const url = new URL(pageUrl),
    path = url.pathname + url.search;
  const name = "sessionKeyEventRate:" + event;
  const raw = await read({
    property,
    dateRanges: [{ startDate: period.from, endDate: period.to }],
    dimensions: [{ name: LANDING }, { name: CHANNEL }],
    metrics: [{ name: "sessions" }, { name }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          {
            filter: {
              fieldName: LANDING,
              stringFilter: {
                matchType: "EXACT",
                value: path,
                caseSensitive: true,
              },
            },
          },
          {
            filter: {
              fieldName: CHANNEL,
              inListFilter: { values: CHANNELS, caseSensitive: true },
            },
          },
        ],
      },
    },
    limit: CHANNELS.length,
    returnPropertyQuota: true,
  });
  const report = ga4ReportSchema.parse(
    unwrapNativeStatistics(raw, ["metricHeaders"]),
  );
  if (
    report.rowCount !== CHANNELS.length ||
    report.rows.length !== CHANNELS.length ||
    report.metadata?.timeZone !== zone ||
    report.metadata.subjectToThresholding ||
    report.metadata.dataLossFromOtherRow ||
    report.metadata.samplingMetadatas?.length ||
    report.metricHeaders.map((h) => h.name).join() !==
      ["sessions", name].join() ||
    report.dimensionHeaders.map((h) => h.name).join() !==
      [LANDING, CHANNEL].join()
  )
    return;
  const channels = new Map<string, { sessions: number; rate: number }>();
  for (const r of report.rows) {
    const [p, c] = r.dimensionValues,
      [visits, rate] = r.metricValues;
    if (
      r.dimensionValues.length !== 2 ||
      r.metricValues.length !== 2 ||
      p?.value !== path ||
      !c ||
      !CHANNELS.includes(c.value) ||
      !visits ||
      !Number.isSafeInteger(visits.value) ||
      visits.value < MIN_SESSIONS ||
      !rate ||
      rate.value > 1
    )
      return;
    channels.set(c.value, { sessions: visits.value, rate: rate.value });
  }
  const organic = channels.get("Organic Search"),
    direct = channels.get("Direct");
  if (organic?.sessions === sessions && direct)
    return { from: period.from, to: period.to, organic, direct };
}

export async function investigateLandingGoal({
  query,
  actor,
  pages,
  before,
  after,
  read,
}: {
  query: NativeStatisticsQuery;
  actor: SeoActor;
  pages: { id: string; url: string }[];
  before: SeoLandingPages;
  after: SeoLandingPages;
  read: ReadReport;
}): Promise<SeoGoalInvestigation | undefined> {
  const zone = after.timeZone;
  const duration = Date.parse(query.to) - Date.parse(query.from) + DAY_MS;
  if (
    actor.sokoBotId ||
    before.channel !== "organic" ||
    after.channel !== "organic" ||
    !zone ||
    before.timeZone !== zone ||
    (duration % WEEK_MS !== 0 && duration < MIN_NON_WEEKLY_DURATION) ||
    query.to >=
      new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date()) ||
    before.rows.length !== query.pageUrls.length ||
    after.rows.length !== query.pageUrls.length
  )
    return;
  const candidates = after.rows
    .flatMap((row) => {
      const earlier = before.rows.find(
        (prior) => prior.pageUrl === row.pageUrl,
      );
      if (
        !earlier ||
        !Number.isSafeInteger(earlier.sessions) ||
        !Number.isSafeInteger(row.sessions) ||
        !Number.isSafeInteger(earlier.keyEvents) ||
        !Number.isSafeInteger(row.keyEvents) ||
        earlier.sessions < MIN_SESSIONS ||
        row.sessions < MIN_SESSIONS ||
        earlier.keyEvents < MIN_BASELINE_EVENTS
      )
        return [];
      const beforeRate = earlier.keyEvents / earlier.sessions;
      const afterRate = row.keyEvents / row.sessions;
      return decreased(beforeRate, afterRate)
        ? [{ row, earlier, decline: 1 - afterRate / beforeRate }]
        : [];
    })
    .sort(
      (a, b) =>
        b.decline - a.decline || a.row.pageUrl.localeCompare(b.row.pageUrl),
    );
  if (!candidates.length) return;
  const brief = seoBriefContent.safeParse(
    (await currentBrief(actor, prisma))?.payload,
  );
  if (!brief.success) return;
  for (const { row, earlier } of candidates) {
    const page = pages.find((p) => p.url === row.pageUrl);
    const goal = brief.data.pages.find((p) => p.pageId === page?.id)?.action;
    const event =
      goal === "buy" ? "purchase" : goal === "sign up" ? "sign_up" : null;
    if (!event) continue;
    const [baseline, recent] = await Promise.all([
      readGoalPeriod(
        read,
        query.propertyId,
        previousSeoPeriod(query.from, query.to),
        row.pageUrl,
        event,
        zone,
        earlier.sessions,
      ),
      readGoalPeriod(
        read,
        query.propertyId,
        query,
        row.pageUrl,
        event,
        zone,
        row.sessions,
      ),
    ]);
    if (
      !baseline ||
      !recent ||
      baseline.organic.rate * baseline.organic.sessions < MIN_BASELINE_EVENTS ||
      baseline.direct.rate * baseline.direct.sessions < MIN_BASELINE_EVENTS
    )
      return;
    const assessment = !decreased(baseline.organic.rate, recent.organic.rate)
      ? "goal_held"
      : decreased(baseline.direct.rate, recent.direct.rate)
        ? "both_declined"
        : "organic_declined";
    return {
      pageUrl: row.pageUrl,
      timeZone: zone,
      event,
      before: baseline,
      after: recent,
      assessment,
      ...(duration % WEEK_MS !== 0 && { weekdayMix: "uneven" as const }),
    };
  }
}
