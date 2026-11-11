import { getFormatter, getTranslations } from "next-intl/server";
import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { coreClient } from "@/lib/clients/core.client";

interface OrganizationCreditSpendCardProps {
  organizationId: string;
}

/** Owner/admin card: credits billed to each person this month and last. */
export async function OrganizationCreditSpendCard({
  organizationId,
}: OrganizationCreditSpendCardProps) {
  const t = await getTranslations(
    "App.Organizations.OrganizationDetail.CreditSpend",
  );
  const format = await getFormatter();

  let spend: Awaited<
    ReturnType<typeof coreClient.getOrganizationCreditSpend>
  >["data"];
  try {
    spend = (await coreClient.getOrganizationCreditSpend(organizationId)).data;
  } catch (error) {
    console.error("Failed to load organization credit spend", error);
    return (
      <CoreAuthReadRetry
        description={t("loadError")}
        retryLabel={t("retry")}
        title={t("title")}
      />
    );
  }

  const monthLabel = (month: string) =>
    format.dateTime(new Date(`${month}-01T00:00:00Z`), {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  const credits = (value: number) =>
    format.number(value, { maximumFractionDigits: 2 });
  const name = (row: (typeof spend.rows)[number]) =>
    row.userId === null ? t("noPerson") : (row.name ?? t("unknownPerson"));
  const spenders = spend.rows.filter(
    (row) => row.credits > 0 || row.previousCredits > 0,
  );
  const peak = Math.max(
    ...spenders.flatMap((row) => [row.credits, row.previousCredits]),
  );
  const bar = (value: number) =>
    value > 0 ? `${Math.max((value / peak) * 100, 1)}%` : "0%";

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {spenders.length > 0 ? (
          <div className="space-y-6">
            {/* Visual comparison only; the table below carries the same figures for assistive tech. */}
            <figure aria-hidden="true" className="space-y-3">
              <figcaption className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="bg-chart-1 size-2.5 rounded-sm" />
                  {monthLabel(spend.month)}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="bg-chart-2 size-2.5 rounded-sm" />
                  {monthLabel(spend.previousMonth)}
                </span>
              </figcaption>
              <ul className="space-y-3">
                {spenders.map((row) => (
                  <li key={row.userId ?? "none"} className="min-w-0 space-y-1">
                    <p className="truncate text-sm">{name(row)}</p>
                    <div
                      className="bg-chart-1 h-2 rounded-sm"
                      style={{ width: bar(row.credits) }}
                      title={credits(row.credits)}
                    />
                    <div
                      className="bg-chart-2 h-2 rounded-sm"
                      style={{ width: bar(row.previousCredits) }}
                      title={credits(row.previousCredits)}
                    />
                  </li>
                ))}
              </ul>
            </figure>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("person")}</TableHead>
                  <TableHead className="text-right">
                    {monthLabel(spend.month)}
                  </TableHead>
                  <TableHead className="text-right">
                    {monthLabel(spend.previousMonth)}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spend.rows.map((row) => (
                  <TableRow key={row.userId ?? "none"}>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-2">
                        {name(row)}
                        {row.userId !== null && !row.isMember ? (
                          <Badge variant="secondary">{t("formerMember")}</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {credits(row.credits)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {credits(row.previousCredits)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        )}
      </CardContent>
    </Card>
  );
}
