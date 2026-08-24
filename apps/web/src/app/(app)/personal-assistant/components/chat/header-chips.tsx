"use client";

import {
  Brain,
  CalendarClock,
  Settings as SettingsIcon,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SokoBotAutonomyLevel } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

export type PanelKey = "autonomy" | "schedules" | "memory" | "settings";

const chipClassName =
  "border-border bg-card text-foreground hover:bg-muted/40 hover:border-foreground/30 focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-full border px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:gap-2 sm:px-2.5";

function Chip({
  icon: Icon,
  label,
  tooltip,
  badge,
  onClick,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  tooltip: string;
  badge?: string | number | null;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={chipClassName}
          aria-label={label}
        >
          <Icon className="text-muted-foreground size-3.5" aria-hidden />
          <span className="hidden sm:inline">{label}</span>
          {badge !== undefined && badge !== null ? (
            <span
              className={cn(
                "bg-muted text-foreground rounded-full px-1.5 text-[0.625rem] tabular-nums",
              )}
            >
              {badge}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Floating top-right controls. Everything that used to be a sidebar panel
 * lives behind one of these: how much the bot may do alone, what it runs
 * on a schedule, what it remembers, and the danger zone.
 */
export function HeaderChips({
  autonomyLevel,
  scheduleCount,
  onOpen,
}: {
  autonomyLevel: SokoBotAutonomyLevel;
  scheduleCount: number;
  onOpen: (panel: PanelKey) => void;
}) {
  const t = useTranslations("App.SokoBot.Chat.chips");
  const tLevel = useTranslations("Components.SokoBot.Autonomy");
  return (
    <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
      <Chip
        icon={Zap}
        label={t("autonomy")}
        tooltip={t("autonomyTooltip", { level: tLevel(autonomyLevel) })}
        badge={tLevel(autonomyLevel)}
        onClick={() => onOpen("autonomy")}
      />
      <Chip
        icon={CalendarClock}
        label={t("schedules")}
        tooltip={t("schedulesTooltip")}
        badge={scheduleCount > 0 ? scheduleCount : null}
        onClick={() => onOpen("schedules")}
      />
      <Chip
        icon={Brain}
        label={t("memory")}
        tooltip={t("memoryTooltip")}
        onClick={() => onOpen("memory")}
      />
      <Chip
        icon={SettingsIcon}
        label={t("settings")}
        tooltip={t("settingsTooltip")}
        onClick={() => onOpen("settings")}
      />
    </div>
  );
}
