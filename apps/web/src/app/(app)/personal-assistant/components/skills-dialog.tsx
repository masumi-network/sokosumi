"use client";

import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import SkillsMarketplace from "./skills-marketplace";

interface SkillsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewMode: boolean;
  hasActiveSubscription?: boolean;
  onRequireSubscription?: () => void;
}

/**
 * The Skills marketplace as a wide popup over the chat — opened from the
 * SkillsChip in the header. Uses the full "settings" variant (search + all
 * shelves) so it works as a proper marketplace, not a trimmed picker.
 *
 * The marketplace only mounts while the dialog is open — its catalog fetch
 * starts on first open and the component unmounts on close, so a reopen
 * refetches fresh installed/preinstalled state.
 */
export default function SkillsDialog({
  open,
  onOpenChange,
  previewMode,
  hasActiveSubscription = true,
  onRequireSubscription,
}: SkillsDialogProps) {
  const t = useTranslations("App.Hermes.SkillsPanel");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl lg:max-w-3xl">
        <DialogHeader className="border-border/40 border-b px-6 pt-6 pb-4">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {/* Mount only while open so catalog fetch is intentional and not
              dependent on Radix Presence keeping content around. Reopen
              remounts and refetches fresh installed/preinstalled state. */}
          {open && !previewMode ? (
            <SkillsMarketplace
              variant="settings"
              hideHeader
              hasActiveSubscription={hasActiveSubscription}
              onRequireSubscription={onRequireSubscription}
            />
          ) : null}
          {open && previewMode ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {t("previewUnavailable")}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
