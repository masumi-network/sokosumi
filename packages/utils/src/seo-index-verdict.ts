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

/** The caller must authorize the parent scope. Sync wins ties and conflicting simultaneous audits remain inconclusive. */
export function newerSeoAuditVerdict<
  T extends {
    pageUrl: string;
    checkedAt: ReadTime;
    status: string;
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
    const recorded =
      assessment.status === "unavailable"
        ? undefined
        : (assessment.evidence
            ?.map(seoInspectionEvidence)
            .find((read) => read !== undefined) ??
          (assessment.status === "indexed"
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
  return best;
}
