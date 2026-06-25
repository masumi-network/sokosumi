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
}

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
 * fires on change). Keeps copy in one place so the two surfaces stay in sync.
 *
 * Borders-first to match the rest of setup: a single bordered card with the
 * three tiers as `divide-y` rows (quiet muted icon, label + one-line body, and
 * a right-side radio dot). The selected row gets a subtle filled surface and a
 * filled radio — no accent rings (they read poorly against the foreground
 * text); meaning rides the "Recommended" / "Spends credits" badges instead.
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
      className={cn(
        "border-border/60 bg-card/40 divide-border/60 flex flex-col divide-y overflow-hidden rounded-xl border",
        disabled && "opacity-60",
      )}
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
                "group flex items-start gap-3 transition-colors",
                compact ? "px-4 py-3" : "px-4 py-3.5",
                disabled ? "cursor-not-allowed" : "cursor-pointer",
                isSelected ? "bg-card" : "hover:bg-card/70",
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

              <Icon
                className={cn(
                  "mt-0.5 size-[18px] shrink-0 transition-colors",
                  isSelected
                    ? "text-foreground"
                    : "text-muted-foreground group-hover:text-foreground/70",
                )}
                aria-hidden
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-foreground text-sm font-medium tracking-tight">
                    {t(labelKey)}
                  </span>
                  {recommended ? (
                    <span className="text-primary border-primary/25 bg-primary/5 rounded-full border px-1.5 py-0.5 text-xs font-medium uppercase tracking-wider">
                      {t("autonomyMediumRecommended")}
                    </span>
                  ) : null}
                  {spendBadgeKey ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
                      <Coins className="size-2.5" aria-hidden />
                      <span>{t(spendBadgeKey)}</span>
                    </span>
                  ) : null}
                </div>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  {t(bodyKey)}
                </p>
              </div>

              {/* Radio dot — fills on selection. Quiet affordance, no reflow. */}
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors",
                  isSelected
                    ? "border-foreground"
                    : "border-border group-hover:border-foreground/40",
                )}
              >
                <span
                  className={cn(
                    "bg-foreground size-2.5 rounded-full transition-transform",
                    isSelected ? "scale-100" : "scale-0",
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
