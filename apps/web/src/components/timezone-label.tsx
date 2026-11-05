"use client";

import { useLocale } from "next-intl";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatTimezoneLabel } from "@/lib/schedules/timezones";

interface TimezoneLabelProps {
  timeZone: string;
  at: Date;
  variant?: "full" | "short";
}

export function TimezoneLabel({
  timeZone,
  at,
  variant = "full",
}: TimezoneLabelProps) {
  const locale = useLocale();
  const full = formatTimezoneLabel(timeZone, locale, at);
  if (variant === "full") return <span>{full}</span>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="cursor-help whitespace-nowrap underline decoration-dotted underline-offset-2 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          {formatTimezoneLabel(timeZone, locale, at, "short")}
        </button>
      </TooltipTrigger>
      <TooltipContent>{full}</TooltipContent>
    </Tooltip>
  );
}
