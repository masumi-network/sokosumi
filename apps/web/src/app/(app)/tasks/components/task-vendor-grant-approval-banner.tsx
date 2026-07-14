"use client";

import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { VendorGrantApprovalActions } from "@/components/vendor-grants/vendor-grant-approval-actions";
import {
  approveMyVendorGrant,
  denyMyVendorGrant,
} from "@/lib/actions/account/vendor-grant-action";
import {
  approveOrganizationVendorGrant,
  denyOrganizationVendorGrant,
} from "@/lib/actions/organization/vendor-grant-action";

interface TaskVendorGrantApprovalBannerProps {
  grantId: string;
  coworkerName: string | null;
  organizationId: string | null;
  reviewHref: string;
}

export function TaskVendorGrantApprovalBanner({
  grantId,
  coworkerName,
  organizationId,
  reviewHref,
}: TaskVendorGrantApprovalBannerProps) {
  const t = useTranslations("App.Tasks.Detail.VendorGrantApproval");

  function approve() {
    if (organizationId) {
      return approveOrganizationVendorGrant({ organizationId, grantId });
    }
    return approveMyVendorGrant({ grantId });
  }

  function deny() {
    if (organizationId) {
      return denyOrganizationVendorGrant({ organizationId, grantId });
    }
    return denyMyVendorGrant({ grantId });
  }

  return (
    <Alert className="mt-4">
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {coworkerName
            ? t("descriptionWithCoworker", { coworkerName })
            : t("description")}
        </p>
        <VendorGrantApprovalActions
          canApprove
          reviewHref={reviewHref}
          labels={{
            approve: t("approve"),
            deny: t("deny"),
            review: t("review"),
            approveSuccess: t("approveSuccess"),
            denySuccess: t("denySuccess"),
            approveError: t("approveError"),
            denyError: t("denyError"),
          }}
          onApprove={approve}
          onDeny={deny}
        />
      </AlertDescription>
    </Alert>
  );
}
