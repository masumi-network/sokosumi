"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type MouseEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useNotifications } from "@/contexts/notification-provider";
import {
  approveMyVendorGrant,
  approveOrganizationVendorGrant,
} from "@/lib/actions/workspace-approval-action";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import {
  isPendingWorkspaceApprovalNotification,
  resolveWorkspaceApprovalNotificationTarget,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
} from "@/lib/utils/workspace-approval";

interface VendorGrantNotificationActionsProps {
  notification: Pick<
    NotificationItem,
    "id" | "messageKey" | "referenceId" | "metadata" | "isRead"
  >;
  layout: "toast" | "inline";
}

export function VendorGrantNotificationActions({
  notification,
  layout,
}: VendorGrantNotificationActionsProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { removeNotification } = useNotifications();
  const [loadingAction, setLoadingAction] = useState<"accept" | null>(null);
  const [accepted, setAccepted] = useState(false);

  const target = resolveWorkspaceApprovalNotificationTarget(
    notification,
    VENDOR_GRANT_PENDING_MESSAGE_KEY,
  );
  if (
    accepted ||
    !isPendingWorkspaceApprovalNotification(
      notification,
      VENDOR_GRANT_PENDING_MESSAGE_KEY,
    ) ||
    !target
  ) {
    return null;
  }

  const { requestId: grantId, organizationId } = target;

  async function handleAccept(
    event: MouseEvent<HTMLButtonElement>,
  ): Promise<void> {
    event.stopPropagation();
    if (loadingAction !== null) {
      return;
    }

    setLoadingAction("accept");
    try {
      const result =
        typeof organizationId === "string"
          ? await approveOrganizationVendorGrant({
              organizationId,
              grantId,
            })
          : await approveMyVendorGrant({ grantId });

      if (!result.ok) {
        toast.error(result.error?.message ?? t("vendorGrantAcceptError"));
        return;
      }

      setAccepted(true);
      removeNotification(notification.id);
      toast.success(t("vendorGrantAcceptSuccess"));
    } catch {
      toast.error(t("vendorGrantAcceptError"));
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <div
      className={cn("flex flex-wrap gap-2", layout === "toast" && "pt-1")}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Button
        type="button"
        size="sm"
        disabled={loadingAction !== null}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => void handleAccept(event)}
      >
        {loadingAction === "accept" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : null}
        {t("accept")}
      </Button>
    </div>
  );
}
