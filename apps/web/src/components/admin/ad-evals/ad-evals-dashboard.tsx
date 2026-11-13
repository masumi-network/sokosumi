import type { AdminAdEvalsDashboard } from "@sokosumi/core-client";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ExportAdEvalsButton } from "./export-ad-evals-button";

interface AdEvalsDashboardProps {
  data: AdminAdEvalsDashboard;
}

export async function AdEvalsDashboard({ data }: AdEvalsDashboardProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.AdEvals"),
    getFormatter(),
  ]);

  function metric(
    value: number | null,
    ci: { lower: number; upper: number } | null,
    percent = false,
  ) {
    if (value === null) return <span className="text-muted-foreground">—</span>;
    const number = (number: number) =>
      format.number(
        number,
        percent
          ? { style: "percent", maximumFractionDigits: 0 }
          : { maximumFractionDigits: 2 },
      );
    return (
      <div className="space-y-0.5 tabular-nums">
        <div>{number(value)}</div>
        {ci ? (
          <div className="text-muted-foreground text-xs">
            {number(ci.lower)}–{number(ci.upper)}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-2">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <section
        className={cn(HOLDER_CLASS, "space-y-2")}
        aria-labelledby="ad-leaderboard-title"
      >
        <div className="space-y-1 px-2 py-1">
          <h2 id="ad-leaderboard-title" className="text-sm font-medium">
            {t("Leaderboard.title")}
          </h2>
          <p className="text-muted-foreground text-xs">
            {t("Leaderboard.help", { minimum: data.minimumWorkspaces })}
          </p>
        </div>
        <div className={cn(HOLDER_ITEM_CLASS, "overflow-hidden")}>
          {data.leaderboard.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">
              {t("Leaderboard.empty")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Leaderboard.model")}</TableHead>
                  <TableHead>{t("Leaderboard.adType")}</TableHead>
                  <TableHead>{t("Leaderboard.thumbs")}</TableHead>
                  <TableHead>{t("Leaderboard.pairwise")}</TableHead>
                  <TableHead>{t("Leaderboard.judge")}</TableHead>
                  <TableHead>{t("Leaderboard.n")}</TableHead>
                  <TableHead>{t("Leaderboard.workspaces")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.leaderboard.map((row) => (
                  <TableRow key={`${row.model}:${row.template}:${row.aspect}`}>
                    <TableCell className="font-medium">{row.model}</TableCell>
                    <TableCell>
                      {row.template ?? t("unknownTemplate")} ·{" "}
                      {row.aspect ?? "—"}
                    </TableCell>
                    {row.suppressed ? (
                      <TableCell colSpan={3}>
                        <Badge variant="secondary">
                          {t("Leaderboard.suppressed")}
                        </Badge>
                      </TableCell>
                    ) : (
                      <>
                        <TableCell>
                          {metric(row.thumbRate, row.thumbRateCi, true)}
                        </TableCell>
                        <TableCell>
                          {metric(
                            row.pairwiseWinRate,
                            row.pairwiseWinRateCi,
                            true,
                          )}
                        </TableCell>
                        <TableCell>
                          {metric(row.judgeMean, row.judgeMeanCi)}
                        </TableCell>
                      </>
                    )}
                    <TableCell className="tabular-nums">
                      {format.number(row.n)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {format.number(row.workspaceCount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
      <section
        className={cn(HOLDER_CLASS, "space-y-2")}
        aria-labelledby="ad-agreement-title"
      >
        <div className="space-y-1 px-2 py-1">
          <h2 id="ad-agreement-title" className="text-sm font-medium">
            {t("Agreement.title")}
          </h2>
          <p className="text-muted-foreground text-xs">{t("Agreement.help")}</p>
        </div>
        <div className={cn(HOLDER_ITEM_CLASS, "overflow-hidden")}>
          {data.agreement.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">
              {t("Agreement.empty")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Agreement.criterion")}</TableHead>
                  <TableHead>{t("Agreement.signal")}</TableHead>
                  <TableHead>{t("Agreement.correlation")}</TableHead>
                  <TableHead>{t("Agreement.n")}</TableHead>
                  <TableHead>{t("Agreement.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.agreement.map((row) => (
                  <TableRow key={`${row.criterion}:${row.signal}`}>
                    <TableCell>
                      {t.has(`Criteria.${row.criterion}`)
                        ? t(`Criteria.${row.criterion}`)
                        : row.criterion}
                    </TableCell>
                    <TableCell>{t(`Agreement.${row.signal}`)}</TableCell>
                    <TableCell className="tabular-nums">
                      {row.rho === null
                        ? "—"
                        : format.number(row.rho, { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {format.number(row.n)}
                    </TableCell>
                    <TableCell>
                      {row.lowAgreement ? (
                        <Badge variant="secondary">{t("Agreement.low")}</Badge>
                      ) : row.rho === null ? (
                        t("Agreement.insufficient")
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
      <section
        className={cn(HOLDER_CLASS, "space-y-2")}
        aria-labelledby="ad-export-title"
      >
        <h2 id="ad-export-title" className="px-2 py-1 text-sm font-medium">
          {t("Export.title")}
        </h2>
        <div
          className={cn(
            HOLDER_ITEM_CLASS,
            "flex flex-wrap items-center justify-between gap-3 p-4",
          )}
        >
          <p className="text-muted-foreground text-sm">{t("Export.help")}</p>
          <ExportAdEvalsButton />
        </div>
      </section>
    </div>
  );
}
