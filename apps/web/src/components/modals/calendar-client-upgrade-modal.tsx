"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CalendarClientUpgradeModalProps {
  open: boolean;
  onReload?: () => void;
}

export function CalendarClientUpgradeModal({
  open,
  onReload,
}: CalendarClientUpgradeModalProps) {
  const t = useTranslations("Components.Modals.CalendarClientUpgradeModal");

  function handleReload() {
    if (onReload) {
      onReload();
      return;
    }

    window.location.reload();
  }

  return (
    <Dialog open={open}>
      <DialogContent className="w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="primary" className="w-full" onClick={handleReload}>
            {t("reload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
