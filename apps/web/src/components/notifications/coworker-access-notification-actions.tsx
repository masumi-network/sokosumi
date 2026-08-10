"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type MouseEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useNotifications } from "@/contexts/notification-provider";
import { approveMyCoworkerAccess } from "@/lib/actions/account/coworker-access-action";
import { approveOrganizationCoworkerAccess } from "@/lib/actions/organization/coworker-access-action";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import {
  isPendingCoworkerAccessNotification,
  resolveCoworkerAccessNotificationTarget,
} from "@/lib/utils/coworker-access-notification";

interface CoworkerAccessNotificationActionsProps {
  notification: Pick<
    NotificationItem,
    "id" | "messageKey" | "referenceId" | "metadata" | "isRead"
  >;
  layout: "toast" | "inline";
  /** Called after accept succeeds so parent lists can drop the row. */
  onAccepted?: () => void;
}

export function CoworkerAccessNotificationActions({
  notification,
  layout,
  onAccepted,
}: CoworkerAccessNotificationActionsProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { removeNotification } = useNotifications();
  const [loadingAction, setLoadingAction] = useState<"accept" | null>(null);
  const [accepted, setAccepted] = useState(false);

  const target = resolveCoworkerAccessNotificationTarget(notification);
  if (
    accepted ||
    !isPendingCoworkerAccessNotification(notification) ||
    !target
  ) {
    return null;
  }

  const { accessId, organizationId } = target;

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
          ? await approveOrganizationCoworkerAccess({
              organizationId,
              accessId,
            })
          : await approveMyCoworkerAccess({ accessId });

      if (!result.ok) {
        toast.error(result.error?.message ?? t("coworkerAccessAcceptError"));
        return;
      }

      setAccepted(true);
      removeNotification(notification.id);
      onAccepted?.();
      toast.success(t("coworkerAccessAcceptSuccess"));
    } catch {
      toast.error(t("coworkerAccessAcceptError"));
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
