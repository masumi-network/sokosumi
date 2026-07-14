"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { approveMyVendorGrant } from "@/lib/actions/account/vendor-grant-action";
import type { ActionError } from "@/lib/actions/errors";
import { approveOrganizationVendorGrant } from "@/lib/actions/organization/vendor-grant-action";
import type { Result } from "@/lib/ts-res";

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
  const router = useRouter();
  const [isApproving, setIsApproving] = useState(false);

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

  async function handleApprove() {
    setIsApproving(true);
    try {
      for (const grantId of grantIdsToApprove) {
        const result = await approveGrant(grantId);
        if (!result.ok) {
          toast.error(result.error?.message ?? t("approveError"));
          return;
        }
      }
      toast.success(t("approveSuccess"));
      router.refresh();
    } catch {
      toast.error(t("approveError"));
    } finally {
      setIsApproving(false);
    }
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
        <div className="flex flex-wrap gap-2">
          {canApprove ? (
            <Button
              size="sm"
              disabled={isApproving}
              onClick={() => void handleApprove()}
            >
              {isApproving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              {t("approve")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={canApprove ? "outline" : "default"}
            asChild
          >
            <Link href={reviewHref}>{t("review")}</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
