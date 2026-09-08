"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useNotifications } from "@/contexts/notification-provider";

interface ClearNotificationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called as the request starts, so a parent list can empty itself. */
  onClearing?: () => void;
  /** Called when clearing fails, so a parent list can read itself again. */
  onClearFailed?: () => void;
}

/**
 * The confirmation that empties the notification center.
 *
 * Controlled from outside, because the bell dropdown closes as the dialog
 * opens and a dialog rendered inside it would go with it.
 */
export function ClearNotificationsDialog({
  open,
  onOpenChange,
  onClearing,
  onClearFailed,
}: ClearNotificationsDialogProps) {
  const t = useTranslations("Components.NotificationCenter");
  const tApp = useTranslations("App");
  const { clearNotifications } = useNotifications();
  const [isClearing, setIsClearing] = useState(false);

  async function handleClear(): Promise<void> {
    if (isClearing) {
      return;
    }

    setIsClearing(true);
    onClearing?.();

    try {
      await clearNotifications();
    } catch {
      toast.error(t("clearAllError"));
      onClearFailed?.();
    } finally {
      setIsClearing(false);
      onOpenChange(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("clearAllConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("clearAllConfirmDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isClearing}>
            {tApp("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // The dialog closes when the clear finishes, not as it starts.
              event.preventDefault();
              void handleClear();
            }}
            disabled={isClearing}
          >
            {isClearing ? t("loading") : t("clearAll")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
