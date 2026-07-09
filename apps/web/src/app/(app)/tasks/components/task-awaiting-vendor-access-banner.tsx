"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { coreClient } from "@/lib/clients/core.browser.client";

interface TaskAwaitingVendorAccessBannerProps {
  grantId: string;
  vendorName: string;
}

export function TaskAwaitingVendorAccessBanner({
  grantId,
  vendorName,
}: TaskAwaitingVendorAccessBannerProps) {
  const t = useTranslations("App.Tasks.Detail.AwaitingVendorApproval");
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function runAction(action: "approve" | "deny") {
    setIsPending(true);
    try {
      if (action === "approve") {
        await coreClient.approveMyVendorAccess(grantId);
        toast.success(t("approveSuccess"));
      } else {
        await coreClient.denyMyVendorAccess(grantId);
        toast.success(t("denySuccess"));
      }
      router.refresh();
    } catch {
      toast.error(t("actionError"));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Alert className="mt-4 border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100">
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{t("description", { vendor: vendorName })}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => void runAction("approve")}
          >
            {t("approve")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => void runAction("deny")}
          >
            {t("deny")}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
