import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { EvalCaseResult } from "@/components/admin/evals/eval-case-result";
import {
  EvalCommitRef,
  EvalHistoryStrip,
  EvalOutcomeBadge,
} from "@/components/admin/evals/eval-marks";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { adminEvalRunHref } from "@/lib/constants/admin-evals";
import { adminEvalsService } from "@/lib/services/admin-evals.service";
import { cn } from "@/lib/utils";

export const instant = false;

export const metadata: Metadata = {
  title: "Eval case",
  description: "One eval case in a run, beside the daily run before it",
};

/**
 * One case: why it passed or failed in each repeat, and what the bot did
 * beside what it did in the daily run before, so a regression reads as a
 * difference rather than a verdict.
 */
export default async function AdminEvalCasePage({
  params,
}: {
  params: Promise<{ id: string; caseId: string }>;
}) {
  const { id, caseId: rawCaseId } = await params;
  const caseId = decodeURIComponent(rawCaseId);
  const [t, format, report, baseline] = await Promise.all([
    getTranslations("App.Admin.Evals"),
    getFormatter(),
    adminEvalsService.getRun(id),
    adminEvalsService.getBaseline(id, caseId),
  ]);
  const evalCase = report.cases.find((item) => item.caseId === caseId);
  if (!evalCase) notFound();
  const before = baseline.results[0];
  return (
    <div className="flex w-full flex-col gap-4 px-4 py-2">
      <Link
        href={adminEvalRunHref(id)}
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t("backToRun")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <EvalOutcomeBadge outcome={evalCase.outcome} />
            <h1 className="text-2xl font-semibold tracking-tight">
              {evalCase.title}
            </h1>
          </div>
          <p className="text-muted-foreground text-sm">{evalCase.intent}</p>
          <p className="text-muted-foreground font-mono text-xs">
            {t(`Suite.${evalCase.suite}`)} · {evalCase.area} · {evalCase.caseId}
          </p>
        </div>
        <EvalHistoryStrip history={evalCase.history} />
      </div>
      <div
        className={cn(
          HOLDER_CLASS,
          "grid gap-2",
          before ? "lg:grid-cols-2" : "grid-cols-1",
        )}
      >
        <div className="flex min-w-0 flex-col gap-2">
          {evalCase.results.map((result) => (
            <EvalCaseResult
              key={result.id}
              result={result}
              heading={t("Case.thisRun", { repeat: result.repeat })}
            />
          ))}
        </div>
        {before && baseline.run ? (
          <div className="flex min-w-0 flex-col gap-2">
            <EvalCaseResult
              result={before}
              heading={t("Case.before", {
                when: format.dateTime(baseline.run.createdAt, "dateTimeMedium"),
              })}
            />
            <p className="text-muted-foreground px-2 text-xs">
              <EvalCommitRef run={baseline.run} />
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
