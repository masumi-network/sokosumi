import type { AdminCmoSpend } from "@sokosumi/core-client";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** "exa/search" → "Exa search"; model ids stay as they are. */
function sourceName(source: string, t: (key: string) => string): string {
  if (source === "exa/search") return t("exa");
  if (source === "web_search") return t("webSearch");
  return source;
}

type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/**
 * What the save-time review found in Cuso's plans: how many saves it checked,
 * how many it sent back, and the latest problems, so a drift shows here
 * rather than in the owner's strategy.
 */
function PlanChecks({
  checks,
  t,
  when,
}: {
  checks: AdminCmoSpend["bots"][number]["planChecks"];
  t: Translate;
  when: (at: string) => string;
}) {
  if (checks.checked === 0)
    return <span className="text-muted-foreground">{t("checksNone")}</span>;
  return (
    <div className="space-y-1">
      <p>{t("checked", { checked: checks.checked })}</p>
      {checks.withProblems > 0 ? (
        <p>{t("sentBack", { count: checks.withProblems })}</p>
      ) : null}
      {checks.drifted > 0 ? (
        <p className="text-destructive">
          {t("drifted", { count: checks.drifted })}
        </p>
      ) : null}
      {checks.unavailable > 0 ? (
        <p className="text-muted-foreground">
          {t("unavailable", { count: checks.unavailable })}
        </p>
      ) : null}
      {checks.last ? (
        <div className="text-muted-foreground">
          <p>{t("lastProblems", { at: when(checks.last.at) })}</p>
          <ul className="list-disc pl-4">
            {checks.last.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Spend per CMO bot (Cuso) for a period: what his work cost, what the owner
 * was charged, where the money went (each model, web search, Exa, overhead,
 * images) and which tools he used.
 */
export async function CmoSpendTable({
  spend,
  days,
  periods,
}: {
  spend: AdminCmoSpend;
  days: number;
  periods: number[];
}) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.CmoSpend"),
    getFormatter(),
  ]);
  const usd = (value: number) =>
    value > 0 && value < 0.001
      ? `<${format.number(0.001, { style: "currency", currency: "USD", maximumFractionDigits: 3 })}`
      : format.number(value, {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: value > 0 && value < 1 ? 3 : 2,
          maximumFractionDigits: value > 0 && value < 1 ? 3 : 2,
        });
  const credits = (value: number) =>
    format.number(value, { maximumFractionDigits: 2 });
  const active = spend.bots.filter((bot) => bot.turns > 0);
  const total = active.reduce((sum, bot) => sum + bot.totalUsd, 0);
  const charged = active.reduce((sum, bot) => sum + bot.chargedCredits, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {t("summary", {
            bots: active.length,
            spent: usd(total),
            charged: credits(charged),
          })}
        </p>
        <nav className="flex gap-1" aria-label={t("period")}>
          {periods.map((period) => (
            <Link
              key={period}
              href={`/admin/cmo-spend?days=${period}`}
              aria-current={period === days ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm",
                period === days
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("days", { days: period })}
            </Link>
          ))}
        </nav>
      </div>

      {active.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("business")}</TableHead>
              <TableHead className="text-right">{t("turns")}</TableHead>
              <TableHead className="text-right">{t("spent")}</TableHead>
              <TableHead className="text-right">{t("charged")}</TableHead>
              <TableHead>{t("where")}</TableHead>
              <TableHead>{t("planChecks")}</TableHead>
              <TableHead>{t("tools")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.map((bot) => (
              <TableRow key={bot.sokoBotId} className="align-top">
                <TableCell>
                  <Link
                    href={`/admin/soko-bots/${bot.sokoBotId}`}
                    className="font-medium hover:underline"
                  >
                    {bot.businessName}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    {bot.ownerEmail}
                  </p>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {bot.turns}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {usd(bot.totalUsd)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {credits(bot.chargedCredits)}
                </TableCell>
                <TableCell>
                  <ul className="space-y-0.5 text-xs">
                    {bot.bySource.map((line) => (
                      <li key={line.source} className="flex gap-2">
                        <span className="w-16 shrink-0 text-right tabular-nums">
                          {usd(line.costUsd)}
                        </span>
                        <span>
                          {sourceName(line.source, t)}
                          <span className="text-muted-foreground">
                            {" "}
                            · {t("calls", { calls: line.calls })}
                          </span>
                        </span>
                      </li>
                    ))}
                    {bot.overheadUsd >= 0.0005 ? (
                      <li className="text-muted-foreground flex gap-2">
                        <span className="w-16 shrink-0 text-right tabular-nums">
                          {usd(bot.overheadUsd)}
                        </span>
                        <span>{t("overhead")}</span>
                      </li>
                    ) : null}
                    {bot.imagesCredits > 0 ? (
                      <li className="flex gap-2">
                        <span className="w-16 shrink-0 text-right tabular-nums">
                          {credits(bot.imagesCredits)}
                        </span>
                        <span>{t("images")}</span>
                      </li>
                    ) : null}
                  </ul>
                </TableCell>
                <TableCell className="max-w-xs text-xs whitespace-normal">
                  <PlanChecks
                    checks={bot.planChecks}
                    t={t}
                    when={(at) => format.relativeTime(new Date(at))}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground max-w-xs text-xs whitespace-normal">
                  {bot.tools
                    .map((tool) => `${tool.capability} ${tool.calls}`)
                    .join(" · ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
