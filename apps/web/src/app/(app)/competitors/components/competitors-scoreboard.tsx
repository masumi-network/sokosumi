import type {
  ProjectCompetitorMeasure,
  ProjectCompetitors,
} from "@sokosumi/core-client";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageSearchRows } from "@/components/page-list-search";

import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { CompetitorsPanel } from "./competitors-panel";

type Format = Awaited<ReturnType<typeof getFormatter>>;

function Cell({
  measure,
  format,
  signed = false,
}: {
  measure: ProjectCompetitorMeasure | null;
  format: Format;
  signed?: boolean;
}) {
  if (!measure)
    return (
      <TableCell className="text-muted-foreground text-right">–</TableCell>
    );
  const value = format.number(measure.value, {
    maximumFractionDigits: 1,
    signDisplay: signed ? "exceptZero" : "auto",
  });
  return (
    <TableCell className="text-right tabular-nums">
      {measure.sourceUrl ? (
        <a
          className="underline-offset-2 hover:underline"
          href={measure.sourceUrl}
          rel="noopener noreferrer"
          target="_blank"
          title={format.dateTime(measure.observedAt, {
            day: "numeric",
            month: "short",
          })}
        >
          {value}
        </a>
      ) : (
        value
      )}
    </TableCell>
  );
}

/**
 * Instagram numbers of the business and each competitor, read through the
 * Project's own Instagram account. Left out while no row has a number.
 */
export async function CompetitorsScoreboard({
  data,
}: {
  data: ProjectCompetitors;
}) {
  const t = await getTranslations("App.Competitors.scoreboard");
  const format = await getFormatter();
  const hasNumbers = data.scoreboard.some(
    (row) =>
      row.postsPerWeek ||
      row.engagementPerPost ||
      row.followers ||
      row.followerGrowth,
  );
  if (!hasNumbers) return null;

  return (
    <CompetitorsPanel id="competitors-scoreboard" title={t("title")}>
      <div className={cn(HOLDER_ITEM_CLASS, "overflow-x-auto")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("account")}</TableHead>
              <TableHead className="text-right">{t("posts")}</TableHead>
              <TableHead className="text-right">{t("engagement")}</TableHead>
              <TableHead className="text-right">{t("followers")}</TableHead>
              <TableHead className="text-right">{t("growth")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <PageSearchRows
              rows={data.scoreboard.map((row) => ({
                primary: [row.name],
                content: (
                  <TableRow key={row.competitorId ?? "own"}>
                    <TableCell className="font-medium">
                      {row.name}
                      {row.competitorId ? null : (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          {t("you")}
                        </span>
                      )}
                    </TableCell>
                    <Cell format={format} measure={row.postsPerWeek} />
                    <Cell format={format} measure={row.engagementPerPost} />
                    <Cell format={format} measure={row.followers} />
                    <Cell format={format} measure={row.followerGrowth} signed />
                  </TableRow>
                ),
              }))}
            />
          </TableBody>
        </Table>
      </div>
    </CompetitorsPanel>
  );
}
