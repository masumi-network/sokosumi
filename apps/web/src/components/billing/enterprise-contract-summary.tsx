import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { EnterpriseContractBillingSummary } from "@/lib/services/enterprise-contract-summary.service";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

interface EnterpriseContractSummaryProps {
  billingPortal?: ReactNode;
  spendableCredits?: number | null;
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
  billingPortal,
  spendableCredits,
  summary,
}: EnterpriseContractSummaryProps) {
  const t = await getTranslations("App.Billing.EnterpriseContract");
  const formatter = await getFormatter();
  const poolRemainingCredits = formatCreditsForDisplay(
    summary.poolRemainingCredits,
  );
  const poolTotalCredits = formatCreditsForDisplay(summary.poolTotalCredits);
  const formattedSpendableCredits =
    spendableCredits != null && spendableCredits > 0
      ? formatCreditsForDisplay(spendableCredits)
      : null;

  return (
    <Card>
      <CardHeader className="grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-y-1.5">
        <div className="col-start-1 row-span-1 flex min-w-0 flex-col gap-1 sm:row-span-2">
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>
            {summary.isConsumable ? t("description") : t("postTermDescription")}
          </CardDescription>
        </div>
        <div className="col-start-1 flex flex-col gap-1 sm:col-start-2 sm:items-end sm:text-right">
          <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
            {t("poolBalanceCredits", { credits: poolRemainingCredits })}
          </p>
          <p className="text-muted-foreground text-sm tabular-nums">
            {t("poolBalanceValue", {
              remaining: poolRemainingCredits,
              total: poolTotalCredits,
            })}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Separator />
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {formattedSpendableCredits != null ? (
            <div className="space-y-1 sm:col-span-2">
              <dt className="text-muted-foreground">
                {t("spendableCreditsLabel")}
              </dt>
              <dd className="font-medium tabular-nums">
                {t("spendableCreditsValue", {
                  credits: formattedSpendableCredits,
                })}
              </dd>
            </div>
          ) : null}
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
        {billingPortal ? (
          <>
            <Separator />
            <div>{billingPortal}</div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
