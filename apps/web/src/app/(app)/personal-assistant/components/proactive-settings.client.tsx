"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { updateSokoBotProactiveAction } from "@/lib/actions/soko-bot/action";

function timeZones(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (supported?.length) return supported;
  } catch {
    // Older runtimes: fall through to the short list.
  }
  return ["Europe/Berlin", "Europe/London", "America/New_York", "UTC"];
}

/**
 * Everything the bot does on its own is governed here: a kill switch, a
 * daily cap on self-started turns, and the timezone its rhythms follow.
 */
export function ProactiveSettings({
  initial,
  usedToday,
}: {
  initial: { paused: boolean; dailyLimit: number; timezone: string };
  usedToday: number | null;
}) {
  const t = useTranslations("App.SokoBot.Settings.Proactive");
  const pauseId = useId();
  const limitId = useId();
  const tzId = useId();
  const [paused, setPaused] = useState(initial.paused);
  const [limit, setLimit] = useState(initial.dailyLimit);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [isPending, startTransition] = useTransition();
  const zones = useMemo(timeZones, []);

  function save(input: {
    paused?: boolean;
    dailyLimit?: number;
    timezone?: string;
  }) {
    startTransition(async () => {
      const result = await updateSokoBotProactiveAction({ input });
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        setPaused(initial.paused);
        setLimit(initial.dailyLimit);
        setTimezone(initial.timezone);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor={pauseId} className="text-sm font-medium">
            {t("pauseTitle")}
          </Label>
          <p className="text-muted-foreground text-xs">
            {t("pauseDescription")}
          </p>
        </div>
        <Switch
          id={pauseId}
          checked={paused}
          disabled={isPending}
          onCheckedChange={(next) => {
            setPaused(next);
            save({ paused: next });
          }}
        />
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor={limitId} className="text-sm font-medium">
            {t("limitTitle")}
          </Label>
          <p className="text-muted-foreground text-xs">
            {usedToday === null
              ? t("limitDescription")
              : t("limitUsage", { used: usedToday, limit })}
          </p>
        </div>
        <Input
          id={limitId}
          type="number"
          min={1}
          max={200}
          value={limit}
          disabled={isPending}
          className="w-20 text-right tabular-nums"
          onChange={(event) => setLimit(Number(event.target.value))}
          onBlur={() => {
            const next = Math.min(200, Math.max(1, Math.round(limit) || 1));
            setLimit(next);
            if (next !== initial.dailyLimit) save({ dailyLimit: next });
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={tzId} className="text-sm font-medium">
          {t("timezoneTitle")}
        </Label>
        <p className="text-muted-foreground text-xs">
          {t("timezoneDescription")}
        </p>
        <Select
          value={timezone}
          disabled={isPending}
          onValueChange={(next) => {
            setTimezone(next);
            save({ timezone: next });
          }}
        >
          <SelectTrigger id={tzId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {zones.map((zone) => (
              <SelectItem key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
