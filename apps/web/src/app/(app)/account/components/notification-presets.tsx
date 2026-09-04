"use client";

import { useTranslations } from "next-intl";

import { CollapsibleTrigger } from "@/components/ui/collapsible";
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
 * picking for them. So it is the fold's own trigger, not a fifth stop that
 * claims to be pressed.
 */
export function PresetStops({
  group,
  kinds,
  preset,
  saving,
  onPick,
}: {
  group: string;
  kinds: readonly KindSpec[];
  preset: PresetState;
  /** A write is in flight. The stops stay reachable, and do nothing. */
  saving: boolean;
  onPick: (preset: Preset) => void;
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
          aria-disabled={saving || undefined}
          title={t(PRESET_HINT_KEY[candidate])}
          onClick={() => {
            if (saving) {
              return;
            }

            onPick(candidate);
          }}
          className={cn(
            "focus-visible:ring-ring/50 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px]",
            saving && "opacity-50",
            preset === candidate
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(PRESET_LABEL_KEY[candidate])}
        </button>
      ))}
      {preset === "CUSTOM" ? (
        <CollapsibleTrigger
          title={t(PRESET_HINT_KEY.CUSTOM)}
          className="text-primary bg-primary/5 focus-visible:ring-ring/50 rounded-full border border-dashed px-3 py-1 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-[3px]"
        >
          {t(PRESET_LABEL_KEY.CUSTOM)}
        </CollapsibleTrigger>
      ) : null}
    </div>
  );
}
