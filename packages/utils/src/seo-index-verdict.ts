type ReadTime = Date | string;

const time = (value: ReadTime) =>
  typeof value === "string" ? Date.parse(value) : value.getTime();

const VERDICTS = [
  "PASS",
  "PARTIAL",
  "FAIL",
  "NEUTRAL",
  "VERDICT_UNSPECIFIED",
] as const;

/** Parse the worker's recorded Search Console line, never its interpretation of an indexing issue. */
export function seoInspectionEvidence(line: string) {
  const match = /^Google URL Inspection: ([A-Z_]+); (.+)\.$/.exec(line);
  if (!match) return undefined;
  const verdict = VERDICTS.find((value) => value === match[1]);
  if (!verdict) return undefined;
  return {
    verdict,
    coverageState: match[2] === "no coverage reason returned" ? null : match[2],
  };
}

/** The worker records Google's crawl separately from the time the inspection was read. */
export function seoInspectionCrawlTime(line: string) {
  const match = /^Google last crawled this URL at (.+)\.$/.exec(line);
  if (!match) return null;
  const crawledAt = new Date(match[1]);
  return Number.isNaN(crawledAt.getTime()) ? null : crawledAt;
}

/** A failed read and an explicit unknown share the worker's disposition. Only Core verifies the latter. */
export function seoIndexReviewState<S extends string>(assessment: {
  status: S;
  googleReturnedUnknown?: boolean;
}) {
  return assessment.status === "unavailable" &&
    assessment.googleReturnedUnknown === true
    ? ("unknown" as const)
    : assessment.status;
}

/** The caller must authorize the parent scope. Sync wins ties and conflicting simultaneous audits remain inconclusive. */
export function newerSeoAuditVerdict<
  T extends {
    pageUrl: string;
    checkedAt: ReadTime;
    status: string;
    googleReturnedUnknown?: boolean;
    evidence?: readonly string[];
  },
>(pageUrl: string, syncedAt: ReadTime | undefined, assessments: readonly T[]) {
  let best:
    | {
        assessment: T;
        verdict: (typeof VERDICTS)[number];
        coverageState: string | null;
      }
    | undefined;
  let latest = syncedAt === undefined ? -Infinity : time(syncedAt);
  for (const assessment of assessments) {
    if (assessment.pageUrl !== pageUrl) continue;
    const checked = time(assessment.checkedAt);
    if (checked < latest || !Number.isFinite(checked)) continue;
    const state = seoIndexReviewState(assessment);
    if (state === "unavailable") continue;
    const read = assessment.evidence
      ?.map(seoInspectionEvidence)
      .find((entry) => entry !== undefined);
    const recorded =
      state === "unknown"
        ? {
            verdict: "VERDICT_UNSPECIFIED" as const,
            coverageState:
              read?.verdict === "VERDICT_UNSPECIFIED"
                ? read.coverageState
                : null,
          }
        : (read ??
          (state === "indexed"
            ? { verdict: "PASS" as const, coverageState: null }
            : undefined));
    if (!recorded) continue;
    if (checked === latest) {
      if (
        best?.verdict !== recorded.verdict ||
        best?.coverageState !== recorded.coverageState
      )
        best = undefined;
    } else {
      latest = checked;
      best = { assessment, ...recorded };
    }
  }
  if (!best) return undefined;
  const lastCrawlTime =
    best.assessment.evidence
      ?.map(seoInspectionCrawlTime)
      .find((date) => date !== null) ?? null;
  return { ...best, lastCrawlTime };
}
