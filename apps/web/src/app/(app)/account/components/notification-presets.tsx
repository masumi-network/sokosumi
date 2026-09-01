"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import {
  groupPresets,
  type KindSpec,
  PRESET_HINT_KEY,
  PRESET_LABEL_KEY,
  type Preset,
  type PresetState,
} from "./notification-delivery";

/**
 * A group's own answers: everything, only what waits on you, that quietly, or
 * nothing.
 *
 * The stops read the group they belong to, so a group of two rows that both
 * wait on the reader shows fewer of them rather than two stops that write the
 * same cells. Custom is not one of the answers: it appears only when the
 * reader has set the kinds one by one, and it opens the fold rather than
 * picking for them.
 */
export function PresetStops({
  group,
  kinds,
  preset,
  disabled,
  onPick,
  onCustom,
}: {
  group: string;
  kinds: readonly KindSpec[];
  preset: PresetState;
  disabled: boolean;
  onPick: (preset: Preset) => void;
  onCustom: () => void;
}) {
  const t = useTranslations("App.Account.Notifications");

  return (
    <div
      role="group"
      aria-label={t("presetAriaLabel", { group })}
      className="border-input bg-background inline-flex shrink-0 rounded-full border p-0.5"
    >
      {groupPresets(kinds).map((candidate) => (
        <button
          key={candidate}
          type="button"
          aria-pressed={preset === candidate}
          disabled={disabled}
          title={t(PRESET_HINT_KEY[candidate])}
          onClick={() => {
            onPick(candidate);
          }}
          className={cn(
            "focus-visible:ring-ring/50 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] disabled:opacity-50",
            preset === candidate
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground enabled:hover:text-foreground",
          )}
        >
          {t(PRESET_LABEL_KEY[candidate])}
        </button>
      ))}
      {preset === "CUSTOM" ? (
        <button
          type="button"
          aria-pressed
          title={t(PRESET_HINT_KEY.CUSTOM)}
          onClick={onCustom}
          className="text-primary bg-primary/5 focus-visible:ring-ring/50 rounded-full border border-dashed px-3 py-1 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-[3px]"
        >
          {t(PRESET_LABEL_KEY.CUSTOM)}
        </button>
      ) : null}
    </div>
  );
}
