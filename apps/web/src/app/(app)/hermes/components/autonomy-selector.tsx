"use client";

import { Check, Coins, Eye, MessageCircleQuestion, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";

import type { HermesAutonomyLevel } from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

interface AutonomySelectorProps {
  value: HermesAutonomyLevel;
  onChange: (next: HermesAutonomyLevel) => void;
  disabled?: boolean;
  /** Compact: smaller padding for the settings sheet. Default false (onboarding). */
  compact?: boolean;
}

interface Option {
  value: HermesAutonomyLevel;
  labelKey: string;
  bodyKey: string;
  recommended?: boolean;
  /** When set, render a small spend-warning badge in the header row. */
  spendBadgeKey?: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

// Color contract: ALL tiers use the same neutral chrome — the user said the
// tinted accent rings (primary on medium, amber on high) didn't read well
// against the foreground text when selected. Meaning is carried by the
// "Recommended" and "Spends credits" badges, not by ring colour. Amber is
// kept only on the spend-warning badge itself where it actively signals risk.
const OPTIONS: Option[] = [
  {
    value: "low",
    labelKey: "autonomyLowLabel",
    bodyKey: "autonomyLowBody",
    Icon: Eye,
  },
  {
    value: "medium",
    labelKey: "autonomyMediumLabel",
    bodyKey: "autonomyMediumBody",
    recommended: true,
    Icon: MessageCircleQuestion,
  },
  {
    value: "high",
    labelKey: "autonomyHighLabel",
    bodyKey: "autonomyHighBody",
    spendBadgeKey: "autonomyHighSpendBadge",
    Icon: Zap,
  },
];

/**
 * Three-tier radio selector for `HermesAutonomyLevel`. Used both in the
 * onboarding screen (committed on continue) and the settings sheet (PATCH
 * fires on change). Keeps copy in one place so the two surfaces stay in
 * sync.
 *
 * Cards are full-width, accent-tinted (low/emerald, medium/cyan, high/amber),
 * with the selected tier getting a stronger border + faint accent wash so
 * the selection reads at a glance.
 */
export default function AutonomySelector({
  value,
  onChange,
  disabled,
  compact,
}: AutonomySelectorProps) {
  const t = useTranslations("App.Hermes.Onboarding");

  return (
    <fieldset
      className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2")}
      disabled={disabled}
      aria-label={t("autonomyAriaLabel")}
    >
      {OPTIONS.map(
        ({
          value: optValue,
          labelKey,
          bodyKey,
          recommended,
          spendBadgeKey,
          Icon,
        }) => {
          const isSelected = value === optValue;
          return (
            <label
              key={optValue}
              className={cn(
                "group relative flex cursor-pointer items-start gap-3 rounded-xl border transition-colors",
                compact ? "px-4 py-3" : "px-4 py-3.5",
                isSelected
                  ? "border-border/60 bg-card shadow-sm"
                  : "border-border/60 bg-card/40 hover:border-foreground/30 hover:bg-card",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name="hermes-autonomy"
                value={optValue}
                checked={isSelected}
                onChange={() => onChange(optValue)}
                disabled={disabled}
                className="sr-only"
              />

              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex shrink-0 items-center justify-center rounded-lg transition-colors",
                  compact ? "size-8" : "size-9",
                  isSelected
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground group-hover:bg-muted/80",
                )}
              >
                <Icon className={compact ? "size-4" : "size-[18px]"} />
              </span>

              <div className="min-w-0 flex-1">
                {/* font-weight is held constant across selection states to
                    avoid sub-pixel reflow when toggling; selection is signaled
                    by border + filled tile + the persistent right-side slot. */}
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "text-foreground font-medium tracking-tight",
                      compact ? "text-sm" : "text-sm",
                    )}
                  >
                    {t(labelKey)}
                  </span>
                  {recommended ? (
                    <span className="bg-foreground text-background rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                      {t("autonomyMediumRecommended")}
                    </span>
                  ) : null}
                  {spendBadgeKey ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
                      <Coins className="size-2.5" aria-hidden />
                      <span>{t(spendBadgeKey)}</span>
                    </span>
                  ) : null}
                </div>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  {t(bodyKey)}
                </p>
              </div>

              {/* Reserved slot — width is held even when unselected so the
                  text column doesn't reflow on selection. */}
              <span
                aria-hidden
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center"
              >
                <Check
                  className={cn(
                    "text-foreground size-4 transition-opacity",
                    isSelected ? "opacity-100" : "opacity-0",
                  )}
                />
              </span>
            </label>
          );
        },
      )}
    </fieldset>
  );
}
