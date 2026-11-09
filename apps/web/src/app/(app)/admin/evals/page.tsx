import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EvalRunsTable } from "@/components/admin/evals/eval-runs-table";
import { EvalTrends } from "@/components/admin/evals/eval-trend";
import { RunEvalsDialog } from "@/components/admin/evals/run-evals-dialog.client";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { adminEvalsService } from "@/lib/services/admin-evals.service";
import { cn } from "@/lib/utils";

export const instant = false;

export const metadata: Metadata = {
  title: "Evals",
  description: "Soko Bot and CMO evals, run daily on main",
};

/**
 * Evals: the fixed Soko Bot and CMO cases, run every day on mainnet against
 * what main deployed, and by hand after a merge or while developing. The
 * trend reads PR by PR; a run's page says what got better or worse.
 */
export default async function AdminEvalsPage() {
  const [t, runs, cases] = await Promise.all([
    getTranslations("App.Admin.Evals"),
    adminEvalsService.listRuns(60),
    adminEvalsService.listCases(),
  ]);
  const caseCount = (suite: string) =>
    cases.filter((evalCase) => evalCase.suite === suite).length;
  return (
    <div className="flex w-full flex-col gap-4 px-4 py-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("description", {
              sokoBot: caseCount("soko-bot"),
              cmo: caseCount("cmo"),
            })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/soko-bots/lab"
            className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
          >
            {t("labLink")}
          </Link>
          <RunEvalsDialog />
        </div>
      </div>
      <EvalTrends runs={runs} />
      <div className={cn(HOLDER_CLASS, "flex flex-col gap-2")}>
        <h2 className="px-2 pt-1 text-sm font-medium">{t("Runs.title")}</h2>
        <EvalRunsTable runs={runs} />
      </div>
    </div>
  );
}
