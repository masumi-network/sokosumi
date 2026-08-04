"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type MouseEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useNotifications } from "@/contexts/notification-provider";
import { approveMyVendorGrant } from "@/lib/actions/account/vendor-grant-action";
import { approveOrganizationVendorGrant } from "@/lib/actions/organization/vendor-grant-action";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import {
  isPendingVendorGrantNotification,
  resolveVendorGrantNotificationTarget,
} from "@/lib/utils/vendor-grant-notification";

interface VendorGrantNotificationActionsProps {
  notification: Pick<
    NotificationItem,
    "id" | "messageKey" | "referenceId" | "metadata" | "isRead"
  >;
  layout: "toast" | "inline";
  onDismissed?: () => void;
}

export function VendorGrantNotificationActions({
  notification,
  layout,
  onDismissed,
}: VendorGrantNotificationActionsProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { markRead } = useNotifications();
  const [loadingAction, setLoadingAction] = useState<
    "accept" | "dismiss" | null
  >(null);
  const [accepted, setAccepted] = useState(false);

  const target = resolveVendorGrantNotificationTarget(notification);
  if (accepted || !isPendingVendorGrantNotification(notification) || !target) {
    return null;
  }

  const { grantId, organizationId } = target;

  function finishSurface() {
    toast.dismiss(notification.id);
    onDismissed?.();
  }

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
      void markRead(notification.id).catch(() => {
        // Grant is approved; surface cleanup still proceeds.
      });
      finishSurface();
      toast.success(t("vendorGrantAcceptSuccess"));
    } catch {
      toast.error(t("vendorGrantAcceptError"));
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleDismiss(
    event: MouseEvent<HTMLButtonElement>,
  ): Promise<void> {
    event.stopPropagation();
    if (loadingAction !== null) {
      return;
    }

    setLoadingAction("dismiss");
    try {
      if (!notification.isRead) {
        await markRead(notification.id).catch(() => {
          // Still dismiss the toast when mark-read fails.
        });
      }
      finishSurface();
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
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={loadingAction !== null}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => void handleDismiss(event)}
      >
        {loadingAction === "dismiss" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : null}
        {t("dismiss")}
      </Button>
    </div>
  );
}
