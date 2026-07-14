"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  approveMyVendorGrant,
  denyMyVendorGrant,
} from "@/lib/actions/account/vendor-grant-action";
import type { ActionError } from "@/lib/actions/errors";
import {
  approveOrganizationVendorGrant,
  denyOrganizationVendorGrant,
} from "@/lib/actions/organization/vendor-grant-action";
import type { Result } from "@/lib/ts-res";

interface TaskVendorGrantApprovalBannerProps {
  grantId: string;
  coworkerName: string | null;
  organizationId: string | null;
}

export function TaskVendorGrantApprovalBanner({
  grantId,
  coworkerName,
  organizationId,
}: TaskVendorGrantApprovalBannerProps) {
  const t = useTranslations("App.Tasks.Detail.VendorGrantApproval");
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<"approve" | "deny" | null>(
    null,
  );

  async function runAction(
    action: "approve" | "deny",
    mutation: () => Promise<Result<{ grantId: string }, ActionError>>,
  ) {
    setLoadingAction(action);
    try {
      const result = await mutation();
      if (!result.ok) {
        toast.error(result.error?.message ?? t(`${action}Error`));
        return;
      }
      toast.success(t(`${action}Success`));
      router.refresh();
    } catch {
      toast.error(t(`${action}Error`));
    } finally {
      setLoadingAction(null);
    }
  }

  function approve() {
    if (organizationId) {
      return runAction("approve", () =>
        approveOrganizationVendorGrant({ organizationId, grantId }),
      );
    }
    return runAction("approve", () => approveMyVendorGrant({ grantId }));
  }

  function deny() {
    if (organizationId) {
      return runAction("deny", () =>
        denyOrganizationVendorGrant({ organizationId, grantId }),
      );
    }
    return runAction("deny", () => denyMyVendorGrant({ grantId }));
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
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={loadingAction !== null}
            onClick={() => void approve()}
          >
            {loadingAction === "approve" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            {t("approve")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loadingAction !== null}
            onClick={() => void deny()}
          >
            {loadingAction === "deny" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            {t("deny")}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
