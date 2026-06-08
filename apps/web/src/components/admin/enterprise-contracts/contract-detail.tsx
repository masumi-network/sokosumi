import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { ActivateContractDialog } from "@/components/admin/enterprise-contracts/activate-contract-dialog";
import { CancelContractDialog } from "@/components/admin/enterprise-contracts/cancel-contract-dialog";
import { ContractPeriodsTable } from "@/components/admin/enterprise-contracts/contract-periods-table";
import { ContractStatusBadge } from "@/components/admin/enterprise-contracts/contract-status-badge";
import { PreviewSchedulePanel } from "@/components/admin/enterprise-contracts/preview-schedule-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { EnterpriseContract } from "@/lib/clients/generated/core/types.gen";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

const dateTimeOptions = {
  dateStyle: "medium",
  timeStyle: "short",
} as const;

function formatDateTime(
  formatter: Awaited<ReturnType<typeof getFormatter>>,
  value: Date | null,
): string {
  if (!value) return "—";
  return formatter.dateTime(value, dateTimeOptions);
}

function formatOneTimeExpiresAt(
  formatter: Awaited<ReturnType<typeof getFormatter>>,
  contract: Pick<EnterpriseContract, "oneTimeCredits" | "oneTimeExpiresAt">,
  noExpiryLabel: string,
): string {
  if (contract.oneTimeCredits == null || contract.oneTimeCredits <= 0) {
    return "—";
  }

  if (!contract.oneTimeExpiresAt) {
    return noExpiryLabel;
  }

  return formatter.dateTime(contract.oneTimeExpiresAt, dateTimeOptions);
}

interface ContractDetailProps {
  contract: EnterpriseContract;
}

export async function ContractDetail({ contract }: ContractDetailProps) {
  const t = await getTranslations("App.Admin.EnterpriseContracts.Detail");
  const formatter = await getFormatter();
  const isDraft = contract.status === "draft";
  const isActive = contract.status === "active";
  const hasActions = isDraft || isActive;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {contract.organizationSlug}
            </h1>
            <ContractStatusBadge status={contract.status} />
          </div>
          <p className="text-muted-foreground text-sm font-mono">
            {contract.id}
          </p>
        </div>
        {hasActions ? (
          <div className="flex flex-wrap gap-2">
            {isDraft ? (
              <>
                <Button variant="outline" asChild>
                  <Link
                    href={`/admin/enterprise-contracts/${contract.id}/edit`}
                  >
                    Edit draft
                  </Link>
                </Button>
                <ActivateContractDialog contractId={contract.id} />
              </>
            ) : null}
            {isActive ? (
              <CancelContractDialog contractId={contract.id} />
            ) : null}
          </div>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contract details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div className="space-y-1">
              <dt className="text-muted-foreground">Credits per month</dt>
              <dd className="font-medium tabular-nums">
                {formatter.number(
                  formatCreditsForDisplay(contract.creditsPerMonth),
                )}{" "}
                credits
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">Seats</dt>
              <dd className="font-medium tabular-nums">{contract.seats}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">Periods</dt>
              <dd className="font-medium tabular-nums">{contract.periods}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">One-time credits</dt>
              <dd className="font-medium tabular-nums">
                {contract.oneTimeCredits == null
                  ? "—"
                  : `${formatter.number(formatCreditsForDisplay(contract.oneTimeCredits))} credits`}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">One-time expires</dt>
              <dd className="font-medium">
                {formatOneTimeExpiresAt(formatter, contract, t("noExpiry"))}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">Payment reference</dt>
              <dd className="font-medium">
                {contract.paymentReference ?? "—"}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">External reference</dt>
              <dd className="font-medium">
                {contract.externalReference ?? "—"}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">Activated at</dt>
              <dd className="font-medium">
                {formatDateTime(formatter, contract.activatedAt)}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">Canceled at</dt>
              <dd className="font-medium">
                {formatDateTime(formatter, contract.canceledAt)}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">Contract ends</dt>
              <dd className="font-medium">
                {formatDateTime(formatter, contract.endsAt)}
              </dd>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="font-medium whitespace-pre-wrap">
                {contract.notes ?? "—"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {isDraft ? <PreviewSchedulePanel contractId={contract.id} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Materialized periods</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Separator />
          <ContractPeriodsTable
            periods={contract.contractPeriods ?? []}
            showStatus
          />
        </CardContent>
      </Card>
    </div>
  );
}
