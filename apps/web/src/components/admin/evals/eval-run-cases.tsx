import type {
  EvalCaseReport,
  EvalOutcome,
  EvalRunReport,
} from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import {
  adminEvalCaseHref,
  adminEvalRunHref,
} from "@/lib/constants/admin-evals";
import { cn } from "@/lib/utils";
import {
  EvalHistoryStrip,
  EvalOutcomeBadge,
  EvalRepeatMarks,
  formatPassRate,
} from "./eval-marks";

export const OUTCOME_ORDER: EvalOutcome[] = [
  "regressed",
  "error",
  "failing",
  "flaky",
  "fixed",
  "passing",
  "pending",
  "skipped",
];

/** What failed, in a line: the first failed check, else the judge's first issue, else the error. */
function firstReason(evalCase: EvalCaseReport): string | null {
  for (const result of evalCase.results) {
    const check = result.checks.find((item) => !item.pass);
    if (check) return `${check.label}: ${check.actual}`;
  }
  for (const result of evalCase.results) {
    const issues = result.judge?.issues;
    if (result.judge?.verdict === "fail" && Array.isArray(issues) && issues[0])
      return String(issues[0]);
  }
  return evalCase.results.find((result) => result.error)?.error ?? null;
}

function CaseRow({
  runId,
  evalCase,
}: {
  runId: string;
  evalCase: EvalCaseReport;
}) {
  const t = useTranslations("App.Admin.Evals");
  const reason =
    evalCase.outcome === "passing" ||
    evalCase.outcome === "fixed" ||
    evalCase.outcome === "pending"
      ? null
      : firstReason(evalCase);
  return (
    <li>
      <Link
        href={adminEvalCaseHref(runId, evalCase.caseId)}
        className={cn(
          HOLDER_ITEM_CLASS,
          HOLDER_ITEM_HOVER_CLASS,
          "grid grid-cols-1 items-center gap-x-4 gap-y-1 px-3 py-2 md:grid-cols-[7rem_minmax(0,1fr)_auto_auto_6rem]",
        )}
      >
        <EvalOutcomeBadge outcome={evalCase.outcome} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {evalCase.title}
          </span>
          <span className="text-muted-foreground block truncate text-xs">
            {reason ?? evalCase.intent}
          </span>
        </span>
        <EvalRepeatMarks states={evalCase.states} />
        <EvalHistoryStrip history={evalCase.history} />
        <span className="text-right text-xs tabular-nums">
          {formatPassRate(evalCase.passRate)}
          <span className="text-muted-foreground block">
            {t("wasRate", { rate: formatPassRate(evalCase.baselinePassRate) })}
          </span>
        </span>
      </Link>
    </li>
  );
}

export interface EvalRunFilter {
  suite: "all" | "soko-bot" | "cmo";
  outcome: EvalOutcome | "changes" | "all";
}

function matches(evalCase: EvalCaseReport, filter: EvalRunFilter) {
  if (filter.suite !== "all" && evalCase.suite !== filter.suite) return false;
  if (filter.outcome === "all") return true;
  if (filter.outcome === "changes")
    return !["passing", "pending", "skipped"].includes(evalCase.outcome);
  return evalCase.outcome === filter.outcome;
}

export function filterHref(
  runId: string,
  filter: EvalRunFilter,
  change: Partial<EvalRunFilter>,
): string {
  const next = { ...filter, ...change };
  const params = new URLSearchParams();
  if (next.suite !== "all") params.set("suite", next.suite);
  if (next.outcome !== "all") params.set("outcome", next.outcome);
  const query = params.toString();
  return `${adminEvalRunHref(runId)}${query ? `?${query}` : ""}`;
}

/** Cases by suite and area, the worst first within each area. */
export function EvalRunCases({
  report,
  filter,
}: {
  report: EvalRunReport;
  filter: EvalRunFilter;
}) {
  const t = useTranslations("App.Admin.Evals");
  const shown = report.cases.filter((evalCase) => matches(evalCase, filter));
  if (shown.length === 0)
    return (
      <div className={cn(HOLDER_CLASS)}>
        <p className="text-muted-foreground p-3 text-sm">{t("noCasesMatch")}</p>
      </div>
    );
  const groups = new Map<string, EvalCaseReport[]>();
  for (const evalCase of shown) {
    const key = `${evalCase.suite}\u0000${evalCase.area}`;
    groups.set(key, [...(groups.get(key) ?? []), evalCase]);
  }
  return (
    <div className="flex flex-col gap-3">
      {[...groups.entries()].map(([key, cases]) => {
        const [suite, area] = key.split("\u0000");
        const sorted = [...cases].sort(
          (a, b) =>
            OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome),
        );
        return (
          <section
            key={key}
            className={cn(HOLDER_CLASS, "flex flex-col gap-2")}
          >
            <h3 className="text-muted-foreground px-2 pt-1 text-xs font-medium">
              {t(`Suite.${suite}`)} · {area}
            </h3>
            <ul className="flex flex-col gap-1">
              {sorted.map((evalCase) => (
                <CaseRow
                  key={evalCase.caseId}
                  runId={report.run.id}
                  evalCase={evalCase}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
