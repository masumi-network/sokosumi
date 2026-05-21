"use client";

import { Coins, Eye, MessageCircleQuestion, Zap } from "lucide-react";
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
  /** Per-tier accent (icon tile + selected ring). */
  accent: {
    /** Icon-tile bg + text classes. */
    tile: string;
    /** Border + bg used when selected. */
    selectedRing: string;
  };
}

const OPTIONS: Option[] = [
  {
    value: "low",
    labelKey: "autonomyLowLabel",
    bodyKey: "autonomyLowBody",
    Icon: Eye,
    accent: {
      tile: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      selectedRing: "border-emerald-500/50 bg-emerald-500/[0.04]",
    },
  },
  {
    value: "medium",
    labelKey: "autonomyMediumLabel",
    bodyKey: "autonomyMediumBody",
    recommended: true,
    Icon: MessageCircleQuestion,
    accent: {
      tile: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
      selectedRing: "border-cyan-500/50 bg-cyan-500/[0.04]",
    },
  },
  {
    value: "high",
    labelKey: "autonomyHighLabel",
    bodyKey: "autonomyHighBody",
    spendBadgeKey: "autonomyHighSpendBadge",
    Icon: Zap,
    accent: {
      tile: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
      selectedRing: "border-amber-500/50 bg-amber-500/[0.04]",
    },
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
      className={cn("flex flex-col", compact ? "gap-2" : "gap-3")}
      disabled={disabled}
      aria-label="Hermes autonomy level"
    >
      {OPTIONS.map(
        ({
          value: optValue,
          labelKey,
          bodyKey,
          recommended,
          spendBadgeKey,
          Icon,
          accent,
        }) => {
          const isSelected = value === optValue;
          return (
            <label
              key={optValue}
              className={cn(
                "group relative flex cursor-pointer items-start gap-4 rounded-xl border transition-all",
                compact ? "p-4" : "p-5",
                isSelected
                  ? cn(accent.selectedRing, "shadow-sm")
                  : "border-border bg-card/60 hover:border-foreground/20 hover:bg-card",
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

              {/* Accent icon tile */}
              <span
                aria-hidden
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-xl transition-colors",
                  compact ? "size-9" : "size-10",
                  accent.tile,
                )}
              >
                <Icon className={compact ? "size-4" : "size-[18px]"} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "text-foreground font-semibold tracking-tight",
                      compact ? "text-sm" : "text-base",
                    )}
                  >
                    {t(labelKey)}
                  </span>
                  {recommended ? (
                    <span className="bg-primary/10 text-primary rounded-full px-1.5 py-0.5 text-xs font-medium uppercase tracking-wider">
                      {t("autonomyMediumRecommended")}
                    </span>
                  ) : null}
                  {spendBadgeKey ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
                      <Coins className="size-2.5" aria-hidden />
                      <span>{t(spendBadgeKey)}</span>
                    </span>
                  ) : null}
                </div>
                <p
                  className={cn(
                    "text-muted-foreground mt-1.5 leading-relaxed",
                    compact ? "text-xs" : "text-sm",
                  )}
                >
                  {t(bodyKey)}
                </p>
              </div>

              {/* Selection indicator */}
              <span
                aria-hidden
                className={cn(
                  "mt-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                  isSelected
                    ? "border-foreground bg-foreground"
                    : "border-border bg-background",
                )}
              >
                {isSelected ? (
                  <span className="bg-background size-1.5 rounded-full" />
                ) : null}
              </span>
            </label>
          );
        },
      )}
    </fieldset>
  );
}
