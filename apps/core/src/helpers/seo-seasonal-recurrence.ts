import { hasSeasonalDemandRise } from "@sokosumi/utils";
import type { z } from "zod";
import type { seoSeasonalIdeaSchema } from "@/schemas/project-seo-seasonal.schema";

type Idea = z.infer<typeof seoSeasonalIdeaSchema>;
const MONTHS_PER_YEAR = 12;
const NEAR_WINDOW_MONTHS = 4;
const COMPARISON_MONTHS = MONTHS_PER_YEAR - NEAR_WINDOW_MONTHS;
type Month = { period: string; volume: number };
function offset(period: string, months: number) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + months, 1))
    .toISOString()
    .slice(0, 7);
}
/** Recheck recurring demand against the query history. A distant second season also needs a measured trough. */
export function validateEarlierCycles(idea: Idea, history: Month[]): Idea {
  const measured = new Map(history.map((m) => [m.period, m.volume]));
  const beforePeak = (period: string) =>
    [-4, -3, -2].map((m) => offset(period, m));
  function baseline(periods: string[], median: number) {
    const values = periods
      .flatMap((p) => (measured.has(p) ? [measured.get(p)!] : []))
      .sort((a, b) => a - b);
    return (
      values.length === periods.length &&
      (values[Math.floor((values.length - 1) / 2)] +
        values[Math.floor(values.length / 2)]) /
        2 ===
        median
    );
  }
  const auditMonth = idea.asOf.slice(0, 7);
  const lastNearMonth = offset(auditMonth, NEAR_WINDOW_MONTHS - 1);
  function cycle(
    w: NonNullable<Idea["windows"][number]["earlierCycle"]>,
    target: string,
    yearsBack: number,
  ) {
    const laterPeak = target > lastNearMonth;
    const referenceEnd = laterPeak
      ? w.historicalPeriod
      : offset(auditMonth, -MONTHS_PER_YEAR * (yearsBack - 1));
    const reference = w.referenceMonths;
    if (reference) {
      const expected = Array.from({ length: COMPARISON_MONTHS }, (_, i) =>
        offset(referenceEnd, i - COMPARISON_MONTHS),
      ).filter((month) => measured.has(month));
      if (
        reference.length !== expected.length ||
        !reference.every((month, i) => month === expected[i])
      )
        return false;
    } else if (laterPeak) return false;
    return (
      measured.get(w.historicalPeriod) === w.historicalVolume &&
      hasSeasonalDemandRise(w.historicalVolume, w.baselineMedian) &&
      baseline(
        w.referenceMonths ?? beforePeak(w.historicalPeriod),
        w.baselineMedian,
      )
    );
  }
  const windows: Idea["windows"] = [];
  let previous: string | undefined;
  for (const { earlierCycle, ...window } of idea.windows) {
    const target = window.targetPeriod;
    if (target < auditMonth || target >= offset(auditMonth, MONTHS_PER_YEAR))
      continue;
    const measuredPeak =
      offset(target, -MONTHS_PER_YEAR) === window.historicalPeriod &&
      cycle(window, target, 1);
    const repeats =
      measuredPeak &&
      earlierCycle &&
      offset(window.historicalPeriod, -MONTHS_PER_YEAR) ===
        earlierCycle.historicalPeriod &&
      cycle(earlierCycle, target, 2);
    if (target > lastNearMonth) {
      if (!repeats || !previous) continue;
      // A continuing plateau is one season. Verify a trough between the peaks in the same month of both years.
      function dipped(
        month: string,
        yearsBack: number,
        baselineMedian: number,
      ) {
        const original = measured.get(
          offset(previous!, -yearsBack * MONTHS_PER_YEAR),
        );
        const value = measured.get(offset(month, -yearsBack * MONTHS_PER_YEAR));
        return (
          original !== undefined &&
          value !== undefined &&
          hasSeasonalDemandRise(original, value) &&
          !hasSeasonalDemandRise(value, baselineMedian)
        );
      }
      let separated = false;
      for (
        let month = offset(previous, 1);
        month < target;
        month = offset(month, 1)
      ) {
        if (
          dipped(month, 1, window.baselineMedian) &&
          dipped(month, 2, earlierCycle.baselineMedian)
        ) {
          separated = true;
          break;
        }
      }
      if (!separated) continue;
    }
    if (measuredPeak) previous = target;
    windows.push(repeats ? { ...window, earlierCycle } : window);
  }
  if (!idea.comparison?.earlierEdition) return { ...idea, windows };
  const { earlierEdition: early, ...recent } = idea.comparison,
    last = recent.eventMonth?.period;
  const first = early.eventMonth.period,
    reference = beforePeak(first);
  const next = recent.baselineMedian;
  const repeats =
    idea.event &&
    recent.status === "above_baseline" &&
    last &&
    first.slice(0, 4) === String(Number(last.slice(0, 4)) - 1) &&
    early.previousEventDate.slice(0, 7) === first &&
    early.leadMonth.period === offset(first, -1) &&
    recent.leadMonth?.period === offset(last, -1) &&
    early.baselineMonths.every(
      (m, i) =>
        m.period === reference[i] && m.volume === measured.get(m.period),
    ) &&
    next !== null &&
    baseline(reference, early.baselineMedian) &&
    baseline(beforePeak(last), next) &&
    (["eventMonth", "leadMonth"] as const).some((key) => {
      const a = early[key],
        b = recent[key];
      return (
        a.volume != null &&
        b?.volume != null &&
        measured.get(a.period) === a.volume &&
        measured.get(b.period) === b.volume &&
        hasSeasonalDemandRise(a.volume, early.baselineMedian) &&
        hasSeasonalDemandRise(b.volume, next)
      );
    });
  return { ...idea, windows, comparison: repeats ? idea.comparison : recent };
}
