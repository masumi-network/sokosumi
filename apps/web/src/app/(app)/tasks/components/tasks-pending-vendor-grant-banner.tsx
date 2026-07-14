"use client";

import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { VendorGrantApprovalActions } from "@/components/vendor-grants/vendor-grant-approval-actions";
import { approveMyVendorGrant } from "@/lib/actions/account/vendor-grant-action";
import type { ActionError } from "@/lib/actions/errors";
import { approveOrganizationVendorGrant } from "@/lib/actions/organization/vendor-grant-action";
import { Ok, type Result } from "@/lib/ts-res";

interface TasksPendingVendorGrantBannerProps {
  canApprove: boolean;
  organizationId: string | null;
  reviewHref: string;
  vendorName: string | null;
  pendingVendorCount: number;
  grantIdsToApprove: string[];
  parkedTaskCount: number;
}

export function TasksPendingVendorGrantBanner({
  canApprove,
  organizationId,
  reviewHref,
  vendorName,
  pendingVendorCount,
  grantIdsToApprove,
  parkedTaskCount,
}: TasksPendingVendorGrantBannerProps) {
  const t = useTranslations("App.Tasks.PendingVendorGrantBanner");

  function description() {
    if (!canApprove) {
      return pendingVendorCount === 1
        ? t("descriptionMember")
        : t("descriptionMemberMany", { count: pendingVendorCount });
    }

    if (pendingVendorCount === 1 && vendorName) {
      return t("descriptionOne", { vendorName });
    }

    return t("descriptionMany", { count: pendingVendorCount });
  }

  async function approveGrant(
    grantId: string,
  ): Promise<Result<{ grantId: string }, ActionError>> {
    if (organizationId) {
      return approveOrganizationVendorGrant({ organizationId, grantId });
    }
    return approveMyVendorGrant({ grantId });
  }

  async function approveAllPendingGrants(): Promise<
    Result<unknown, ActionError>
  > {
    for (const grantId of grantIdsToApprove) {
      const result = await approveGrant(grantId);
      if (!result.ok) {
        return result;
      }
    }

    return Ok(undefined);
  }

  return (
    <Alert className="mb-4">
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription className="space-y-3">
        <div className="space-y-1">
          <p>{description()}</p>
          {parkedTaskCount > 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("parkedTasksHint", { count: parkedTaskCount })}
            </p>
          ) : null}
        </div>
        <VendorGrantApprovalActions
          canApprove={canApprove}
          reviewHref={reviewHref}
          labels={{
            approve: t("approve"),
            review: t("review"),
            approveSuccess: t("approveSuccess"),
            approveError: t("approveError"),
          }}
          onApprove={approveAllPendingGrants}
        />
      </AlertDescription>
    </Alert>
  );
}
