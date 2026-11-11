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
  const hasSpend = spend.rows.some(
    (row) => row.credits > 0 || row.previousCredits > 0,
  );

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {hasSpend ? (
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
                      {row.userId === null
                        ? t("noPerson")
                        : (row.name ?? t("unknownPerson"))}
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
        ) : (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        )}
      </CardContent>
    </Card>
  );
}
