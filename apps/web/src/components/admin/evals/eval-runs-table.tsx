import type { EvalRunListItem } from "@sokosumi/core-client";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminEvalRunHref } from "@/lib/constants/admin-evals";
import { cn } from "@/lib/utils";
import { EvalCommitRef, formatCost, formatPassRate } from "./eval-marks";

function SuiteScore({
  run,
  suite,
  toGo,
}: {
  run: EvalRunListItem;
  suite: "soko-bot" | "cmo";
  toGo: (count: number) => string;
}) {
  const score = run.scores[suite];
  if (!score) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="tabular-nums">
      {formatPassRate(score.passRate)}
      <span className="text-muted-foreground ml-1.5 text-xs">
        {score.passed}/{score.scored}
        {score.open > 0 ? ` · ${toGo(score.open)}` : ""}
      </span>
    </span>
  );
}

export async function EvalRunsTable({ runs }: { runs: EvalRunListItem[] }) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.Evals"),
    getFormatter(),
  ]);
  if (runs.length === 0)
    return (
      <div
        className={cn(HOLDER_ITEM_CLASS, "text-muted-foreground p-4 text-sm")}
      >
        {t("noRuns")}
      </div>
    );
  return (
    <div className={cn(HOLDER_ITEM_CLASS, "overflow-hidden")}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Runs.when")}</TableHead>
            <TableHead>{t("Runs.run")}</TableHead>
            <TableHead>{t("Runs.pr")}</TableHead>
            <TableHead>{t("Runs.versions")}</TableHead>
            <TableHead className="text-right">{t("Suite.soko-bot")}</TableHead>
            <TableHead className="text-right">{t("Suite.cmo")}</TableHead>
            <TableHead className="text-right">{t("Runs.cost")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id} className="relative">
              <TableCell className="whitespace-nowrap tabular-nums">
                <Link
                  href={adminEvalRunHref(run.id)}
                  className="after:absolute after:inset-0 hover:underline"
                >
                  {format.dateTime(run.createdAt, "dateTimeMedium")}
                </Link>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {t(`Trigger.${run.trigger}`)}
                {run.status !== "COMPLETED" ? (
                  <span className="text-muted-foreground ml-1.5 text-xs">
                    {t(`Status.${run.status}`)}
                  </span>
                ) : null}
                <span className="text-muted-foreground ml-1.5 text-xs">
                  {run.environment}
                </span>
              </TableCell>
              <TableCell className="relative z-10 max-w-80 truncate">
                <EvalCommitRef run={run} />
                {run.commitMessage ? (
                  <span className="text-muted-foreground ml-2 text-xs">
                    {run.commitMessage.replace(/\s*\(#\d+\)\s*$/, "")}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground font-mono text-xs whitespace-nowrap">
                {[run.models.sokoBotVersionId, run.models.cusoVersionId]
                  .filter(Boolean)
                  .join(" · ")}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <SuiteScore
                  run={run}
                  suite="soko-bot"
                  toGo={(count) => t("openCases", { count })}
                />
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <SuiteScore
                  run={run}
                  suite="cmo"
                  toGo={(count) => t("openCases", { count })}
                />
              </TableCell>
              <TableCell className="text-right tabular-nums whitespace-nowrap">
                {formatCost(run.costUsd)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
