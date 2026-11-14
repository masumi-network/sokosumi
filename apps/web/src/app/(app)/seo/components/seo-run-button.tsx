"use client";

import { CalendarClock, ChevronDown, Loader2, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { seoRunAction } from "./seo-setup-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * The secondary button, one surface up: in dark its own fill is the card's colour, in light only one step off, so
 * on the checks card it would read as bare text. The owner chose the secondary look over the brand fill (2026-11-13).
 */
const SECONDARY_ON_CARD_CLASS = "bg-quaternary hover:bg-tertiary";

/**
 * The run of the page, on the title line of the checks. Its arrow schedules the follow-up: a page check every week
 * or every month, in the schedule form, where the reader reviews it before it is saved. The arrow shows only where a
 * schedule can be made.
 */
export function SeoRunButton({
  model,
  run,
  ready,
  describedBy,
  unavailable,
}: {
  model: SeoWorkspaceModel;
  run: NonNullable<ReturnType<typeof seoRunAction>>;
  /** The pages loaded and the dates are right: a press opens the form. */
  ready: boolean;
  /** The notice that says why no check can start. */
  describedBy?: string;
  /** The pages load or the dates are wrong: no form opens, so no schedule may be asked for either. */
  unavailable: boolean;
}) {
  const t = useTranslations("App.Seo");
  const variant = ready ? "secondary" : "outline";
  const schedule = model.data.availableActions.canCreateMonitor === true;
  return (
    <div className="flex">
      <Button
        size="sm"
        variant={variant}
        // Not the disabled attribute: that drops focus. The button's own text says a check runs.
        aria-disabled={!ready || undefined}
        aria-describedby={describedBy}
        className={cn(
          "aria-disabled:pointer-events-none aria-disabled:opacity-50",
          variant === "secondary" && SECONDARY_ON_CARD_CLASS,
          schedule && "rounded-e-none",
        )}
        onClick={() => {
          if (ready) model.openAnalysis(run.kind);
        }}
      >
        {run.running ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-pulse" />
        ) : (
          <Play className="size-4" />
        )}
        {t(run.label)}
      </Button>
      {schedule ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant={variant}
              title={t("monitor.create")}
              // The line between the halves: a cut in the card colour through the fill, or the border of the outline.
              className={cn(
                "rounded-s-none border-s px-2 max-md:min-w-10",
                variant === "secondary"
                  ? cn(SECONDARY_ON_CARD_CLASS, "border-s-card-background")
                  : "-ms-px",
              )}
            >
              <ChevronDown className="size-4" />
              <span className="sr-only">{t("monitor.create")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={
                unavailable || model.pending || !model.data.scope.pageIds.length
              }
              onSelect={model.openMonitor}
            >
              <CalendarClock className="size-4" />
              {t("monitor.create")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
