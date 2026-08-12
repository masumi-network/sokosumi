"use client";

import { err, ok } from "neverthrow";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { VendorGrantApprovalActions } from "@/components/vendor-grants/vendor-grant-approval-actions";
import { createMyVendorGrant } from "@/lib/actions/account/vendor-grant-action";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors";
import { createOrganizationVendorGrant } from "@/lib/actions/organization/vendor-grant-action";

interface TasksPendingVendorGrantBannerProps {
  canApprove: boolean;
  organizationId: string | null;
  reviewHref: string | null;
  vendorName: string | null;
  pendingVendorCount: number;
  pendingVendorIds: string[];
  parkedTaskCount: number;
}

export function TasksPendingVendorGrantBanner({
  canApprove,
  organizationId,
  reviewHref,
  vendorName,
  pendingVendorCount,
  pendingVendorIds,
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

  async function grantVendorAccess(
    vendorId: string,
  ): Promise<ActionResultDto<{ grantId: string }, ActionError>> {
    if (organizationId) {
      return createOrganizationVendorGrant({
        organizationId,
        vendorId,
      });
    }
    return createMyVendorGrant({ vendorId });
  }

  async function approveAllPendingGrants(): Promise<
    ActionResultDto<unknown, ActionError>
  > {
    let approved = 0;

    for (const vendorId of pendingVendorIds) {
      const result = await grantVendorAccess(vendorId);
      if (!result.ok) {
        if (approved > 0) {
          return toActionResult(
            err({
              code: "vendor_grant_partial_approve",
              message: t("approvePartialError", {
                approved,
                total: pendingVendorIds.length,
              }),
            }),
          );
        }

        return result;
      }

      approved += 1;
    }

    return toActionResult(ok(undefined));
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
          refreshAfterApproveAttempt
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
