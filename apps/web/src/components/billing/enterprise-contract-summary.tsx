import { getFormatter, getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { EnterpriseContractBillingSummary } from "@/lib/services/enterprise-contract-summary.service";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

const ENTERPRISE_CONTACT_HREF = "mailto:info@sokosumi.com";

interface EnterpriseContractSummaryProps {
  summary: EnterpriseContractBillingSummary;
}

function formatDate(
  formatter: Awaited<ReturnType<typeof getFormatter>>,
  value: Date,
): string {
  return formatter.dateTime(value, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export async function EnterpriseContractSummary({
  summary,
}: EnterpriseContractSummaryProps) {
  const t = await getTranslations("App.Billing.EnterpriseContract");
  const formatter = await getFormatter();
  const poolRemainingCredits = formatCreditsForDisplay(
    summary.poolRemainingCredits,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-muted-foreground text-sm font-medium">
            {t("poolBalanceLabel")}
          </p>
          <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
            {t("poolBalanceCredits", { credits: poolRemainingCredits })}
          </p>
        </div>
        <Separator />
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="text-muted-foreground">{t("monthlyGrantLabel")}</dt>
            <dd className="font-medium tabular-nums">
              {t("monthlyGrantCredits", {
                credits: formatCreditsForDisplay(summary.monthlyCredits),
              })}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">
              {t("currentPeriodEndLabel")}
            </dt>
            <dd className="font-medium">
              {summary.currentPeriodEnd
                ? formatDate(formatter, summary.currentPeriodEnd)
                : t("notAvailable")}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">{t("activatedAtLabel")}</dt>
            <dd className="font-medium">
              {formatDate(formatter, summary.activatedAt)}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">{t("contractEndLabel")}</dt>
            <dd className="font-medium">
              {formatDate(formatter, summary.contractEnd)}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">
              {t("nextActivationLabel")}
            </dt>
            <dd className="font-medium">
              {summary.nextActivationAt
                ? formatDate(formatter, summary.nextActivationAt)
                : t("nextActivationNone")}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">
              {t("purchasedSeatsLabel")}
            </dt>
            <dd className="font-medium tabular-nums">
              {t("purchasedSeatsValue", { seats: summary.purchasedSeats })}
            </dd>
          </div>
        </dl>
        <Separator />
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            {t("contactDescription")}
          </p>
          <Button asChild className="w-full sm:w-auto" variant="outline">
            <a href={ENTERPRISE_CONTACT_HREF}>{t("contactUsCta")}</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
