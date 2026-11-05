"use client";

import { CalendarIcon, CircleHelp, X } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { de, enUS, es } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NewsletterAnalyticsDateFilterProps {
  from: string;
  to: string;
  invalid: boolean;
  onChange: (range: { from: string | null; to: string | null }) => void;
}

function parseUtcDate(value: string): Date | undefined {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? undefined
    : date;
}

function presetRange(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export function NewsletterAnalyticsDateFilter({
  from,
  to,
  invalid,
  onChange,
}: NewsletterAnalyticsDateFilterProps) {
  const t = useTranslations("App.Projects.Newsletter.Analytics");
  const formatter = useFormatter();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>();
  const start = parseUtcDate(from);
  const end = parseUtcDate(to);
  const selected =
    !invalid && start && end && start <= end
      ? { from: start, to: end }
      : undefined;
  const presets = [7, 30, 90].map((days) => ({
    days,
    ...presetRange(days),
  }));
  const activePreset = selected
    ? presets.find((preset) => preset.from === from && preset.to === to)
    : undefined;
  const label = activePreset
    ? t("lastDays", { days: activePreset.days })
    : selected
      ? formatter.dateTimeRange(selected.from, selected.to, {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })
      : t("rangeLabel");

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) setDraft(selected);
    setOpen(nextOpen);
  }

  function handleSelect(range: DateRange | undefined, day: Date) {
    // Start a fresh range before applying both dates together.
    if (!draft?.from || draft.to) {
      setDraft({ from: day });
      return;
    }
    setDraft(range);
    if (range?.from && range.to) {
      onChange({
        from: range.from.toISOString().slice(0, 10),
        to: range.to.toISOString().slice(0, 10),
      });
      setOpen(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center justify-end gap-1">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-11 min-w-0 md:h-8"
            aria-label={selected ? t("rangeSelected", { range: label }) : label}
            aria-invalid={invalid || undefined}
            aria-describedby={
              invalid ? "newsletter-analytics-invalid-range" : undefined
            }
          >
            <CalendarIcon className="shrink-0" />
            <span className="whitespace-normal text-start tabular-nums">
              {label}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          aria-label={t("rangeLabel")}
          className="max-h-(--radix-popover-content-available-height) w-auto max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain p-0 motion-reduce:animate-none"
        >
          <div className="flex gap-1 p-3 pb-0">
            {presets.map((preset) => (
              <Button
                key={preset.days}
                variant={
                  activePreset?.days === preset.days ? "secondary" : "ghost"
                }
                size="sm"
                className="h-11 flex-1 md:h-8"
                aria-pressed={activePreset?.days === preset.days}
                onClick={() => {
                  onChange(presetRange(preset.days));
                  setOpen(false);
                }}
              >
                {t("presetDays", { days: preset.days })}
              </Button>
            ))}
          </div>
          <Calendar
            autoFocus
            mode="range"
            timeZone="UTC"
            locale={locale === "de" ? de : locale === "es" ? es : enUS}
            defaultMonth={start}
            selected={draft}
            onSelect={handleSelect}
            className="[--cell-size:--spacing(9)] md:[--cell-size:--spacing(8)]"
          />
          <div className="px-3 pb-3">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-11 w-full md:h-8"
              onClick={() => {
                onChange({ from: null, to: null });
                setOpen(false);
              }}
            >
              <X />
              {t("clearRange")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-11 shrink-0 md:size-8"
            aria-label={t("periodNoteAria")}
          >
            <CircleHelp />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs leading-relaxed" side="bottom">
          {t("periodNote")}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
