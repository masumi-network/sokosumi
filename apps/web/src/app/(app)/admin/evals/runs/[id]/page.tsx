import type { EvalOutcome } from "@sokosumi/core-client";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import {
  EvalCommitRef,
  EvalOutcomeBadge,
  formatCost,
  formatPassRate,
} from "@/components/admin/evals/eval-marks";
import {
  EvalRunCases,
  type EvalRunFilter,
  filterHref,
  OUTCOME_ORDER,
} from "@/components/admin/evals/eval-run-cases";
import {
  CancelEvalRunButton,
  EvalRunRefresh,
} from "@/components/admin/evals/eval-run-live.client";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { SEGMENTED_CONTROL_CLASS_NAME } from "@/components/ui/segmented-control-classes";
import { ADMIN_EVALS_ROUTE } from "@/lib/constants/admin-evals";
import { adminEvalsService } from "@/lib/services/admin-evals.service";
import { cn } from "@/lib/utils";

export const instant = false;

export const metadata: Metadata = {
  title: "Eval run",
  description: "What got better or worse in one eval run",
};

const SUITES = ["all", "soko-bot", "cmo"] as const;

function parseFilter(params: {
  suite?: string;
  outcome?: string;
}): EvalRunFilter {
  const suite = SUITES.find((value) => value === params.suite) ?? "all";
  const outcome =
    params.outcome === "changes" ||
    OUTCOME_ORDER.includes(params.outcome as EvalOutcome)
      ? (params.outcome as EvalRunFilter["outcome"])
      : "all";
  return { suite, outcome };
}

export default async function AdminEvalRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ suite?: string; outcome?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [t, format, report] = await Promise.all([
    getTranslations("App.Admin.Evals"),
    getFormatter(),
    adminEvalsService.getRun(id),
  ]);
  const { run, baseline, summary } = report;
  const filter = parseFilter(query);
  const live = run.status === "QUEUED" || run.status === "RUNNING";
  const segment = (active: boolean) =>
    cn(
      "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors",
      active
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground",
    );
  return (
    <div className="flex w-full flex-col gap-4 px-4 py-2">
      {live ? <EvalRunRefresh /> : null}
      <Link
        href={ADMIN_EVALS_ROUTE}
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t("title")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("runTitle", {
              trigger: t(`Trigger.${run.trigger}`),
              when: format.dateTime(run.createdAt, "dateTimeMedium"),
            })}
          </h1>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
            <EvalCommitRef run={run} />
            {run.commitMessage ? (
              <span>{run.commitMessage.replace(/\s*\(#\d+\)\s*$/, "")}</span>
            ) : null}
            <span>·</span>
            <span className="font-mono text-xs">
              {[run.models.sokoBotVersionId, run.models.sokoBotModel]
                .filter(Boolean)
                .join(" ")}
            </span>
            <span className="font-mono text-xs">
              {[run.models.cusoVersionId, run.models.cusoModel]
                .filter(Boolean)
                .join(" ")}
            </span>
          </p>
          <p className="text-muted-foreground text-sm">
            {baseline ? (
              <>
                {t("comparedWith", {
                  when: format.dateTime(baseline.createdAt, "dateTimeMedium"),
                })}{" "}
                <EvalCommitRef run={baseline} />
              </>
            ) : (
              t("noBaseline")
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">
            {t(`Status.${run.status}`)}
            {summary.open > 0
              ? ` · ${t("openCases", { count: summary.open })}`
              : ""}
          </span>
          {live ? <CancelEvalRunButton runId={run.id} /> : null}
        </div>
      </div>

      <div className={cn(HOLDER_CLASS, "flex flex-wrap items-center gap-2")}>
        <span className="bg-background rounded-lg border px-3 py-2">
          <span className="block text-2xl font-semibold tabular-nums">
            {formatPassRate(
              summary.scored ? summary.passed / summary.scored : null,
            )}
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {t("passedOf", { passed: summary.passed, scored: summary.scored })}
            {" · "}
            {formatCost(summary.costUsd)}
          </span>
        </span>
        {OUTCOME_ORDER.filter(
          (outcome) => (summary.counts[outcome] ?? 0) > 0,
        ).map((outcome) => (
          <Link
            key={outcome}
            href={filterHref(run.id, filter, {
              outcome: filter.outcome === outcome ? "all" : outcome,
            })}
            aria-current={filter.outcome === outcome ? "true" : undefined}
            className={cn(
              "bg-background hover:bg-accent flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
              filter.outcome === outcome && "border-foreground",
            )}
          >
            <EvalOutcomeBadge outcome={outcome} />
            <span className="text-lg font-semibold tabular-nums">
              {summary.counts[outcome]}
            </span>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <nav
          className={SEGMENTED_CONTROL_CLASS_NAME}
          aria-label={t("suiteFilter")}
        >
          {SUITES.map((suite) => (
            <Link
              key={suite}
              href={filterHref(run.id, filter, { suite })}
              aria-current={filter.suite === suite ? "page" : undefined}
              className={segment(filter.suite === suite)}
            >
              {suite === "all" ? t("allSuites") : t(`Suite.${suite}`)}
            </Link>
          ))}
        </nav>
        <nav
          className={SEGMENTED_CONTROL_CLASS_NAME}
          aria-label={t("outcomeFilter")}
        >
          {(["all", "changes"] as const).map((outcome) => (
            <Link
              key={outcome}
              href={filterHref(run.id, filter, { outcome })}
              aria-current={filter.outcome === outcome ? "page" : undefined}
              className={segment(filter.outcome === outcome)}
            >
              {outcome === "all" ? t("allCases") : t("onlyChanges")}
            </Link>
          ))}
        </nav>
      </div>

      <EvalRunCases report={report} filter={filter} />
    </div>
  );
}
