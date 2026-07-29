"use client";

import { useTranslations } from "next-intl";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import SkillsMarketplace from "./skills-marketplace";

interface SkillsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewMode: boolean;
  hasAssistantPlanCoverage?: boolean;
  onRequireSubscription?: () => void;
}

/**
 * The Skills marketplace as a side sheet — opened from the SkillsChip in the
 * chat header, sliding in like the Settings and Autonomy panels. Hosts the
 * full "settings" variant (search + all shelves) with the marketplace's
 * internal header suppressed in favour of the SheetHeader.
 *
 * The marketplace only mounts while the sheet is open — its catalog fetch
 * starts on first open and the component unmounts on close, so a reopen
 * refetches fresh installed/preinstalled state.
 */
export default function SkillsPanel({
  open,
  onOpenChange,
  previewMode,
  hasAssistantPlanCoverage = true,
  onRequireSubscription,
}: SkillsPanelProps) {
  const t = useTranslations("App.Hermes.SkillsPanel");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-border/40 border-b px-6 pt-6 pb-4">
          <SheetTitle className="text-foreground text-lg font-semibold tracking-tight">
            {t("title")}
          </SheetTitle>
          <SheetDescription className="text-muted-foreground text-sm">
            {t("subtitle")}
          </SheetDescription>
        </SheetHeader>
        <div className="px-6 py-6">
          {/* Mount only while open so the catalog fetch is intentional and not
              dependent on Radix Presence keeping content around. Reopen
              remounts and refetches fresh installed/preinstalled state. */}
          {open && !previewMode ? (
            <SkillsMarketplace
              variant="settings"
              hideHeader
              hasAssistantPlanCoverage={hasAssistantPlanCoverage}
              onRequireSubscription={onRequireSubscription}
            />
          ) : null}
          {open && previewMode ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {t("previewUnavailable")}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
