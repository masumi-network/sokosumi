"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { ChevronRight, CircleAlert, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { SeoRunDiff } from "./seo-run-diff";
import { seoRunDiffOf, seoStopCheckId } from "./seo-run-diff-model";
import { SeoTimeline } from "./seo-timeline";
import {
  type SeoStopNode,
  seoNodeResult,
  seoStopDigest,
} from "./seo-timeline-model";

/** Long enough that a pointer passing over the line opens no card. */
const HOVER_OPEN_MS = 300;

/**
 * A stop of the runs row with what happened there: a pointer on it shows the counts and the way to the details.
 * Focus alone opens no card. A click, tap or keyboard activation pins the preview for interaction.
 */
export function SeoRunDayHover({
  workspace,
  day,
  previewLabel,
  nodes,
  issues,
  pinned,
  allowHover,
  onPinnedChange,
  onSelectDay,
  selectLabel,
  onDetails,
  hasComparison = false,
  children,
}: {
  workspace: ProjectSeoWorkspace;
  /** The day as the stop names it. */
  day: string;
  previewLabel: string;
  nodes: SeoStopNode[];
  issues?: number | null;
  /** A pinned preview stays open while the reader chooses a date or opens its details. */
  pinned: boolean;
  allowHover: boolean;
  onPinnedChange: (open: boolean) => void;
  onSelectDay?: () => void;
  selectLabel?: string;
  onDetails: () => void;
  /** The stop compares a check, so its details have something to show also without events. */
  hasComparison?: boolean;
  /** The stop button anchors both the hover preview and the interactive popover. */
  children: ReactNode;
}) {
  const t = useTranslations("App.Seo");
  const report = useSeoResultTranslations("App.Seo");
  const reportFormat = useSeoResultFormatter();
  // Always controlled: a card that switched to controlled while empty would come back open with no pointer on it.
  const [open, setOpen] = useState(false);
  const openingDetails = useRef(false);
  const digest = seoStopDigest(nodes);
  const newest = digest.newestCheck;
  const result = newest ? seoNodeResult(workspace, newest) : null;
  const coverage = newest?.observation?.coverage;
  const hasDetails = nodes.length > 0 || hasComparison;
  const counts = [
    digest.checks ? report("runs.checks", { count: digest.checks }) : null,
    digest.failedChecks
      ? report("runs.failedChecks", { count: digest.failedChecks })
      : null,
    digest.pageChanges
      ? report("runs.pageChanges", { count: digest.pageChanges })
      : null,
    digest.scopeChanges
      ? report("runs.scopeChanges", { count: digest.scopeChanges })
      : null,
    digest.tasks ? report("runs.tasks", { count: digest.tasks }) : null,
    digest.failedSyncs
      ? report("runs.failedSyncs", { count: digest.failedSyncs })
      : null,
  ].filter((count): count is string => count !== null);
  const preview = (
    <>
      <div className="space-y-3 p-4">
        <p lang="en" className="text-muted-foreground text-xs">
          {day}
        </p>
        {result !== null && coverage ? (
          // The result is the headline of the card; the tests behind it sit under it.
          <div lang="en" className="flex gap-3">
            <span className="text-muted-foreground -mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border">
              {result ? (
                <CircleAlert className="size-3.5" />
              ) : (
                <CircleCheck className="size-3.5" />
              )}
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">
                {report("timeline.result", { count: result })}
              </p>
              <p className="text-muted-foreground text-xs">
                {[
                  report("timeline.checkSummary", {
                    checked: coverage.checked,
                  }),
                  coverage.skipped
                    ? report("timeline.rulesSkipped", {
                        count: coverage.skipped,
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
        ) : null}
        {!nodes.length && issues != null && (
          <p lang="en" className="font-medium">
            {report("timeline.result", { count: issues })}
          </p>
        )}
        {!nodes.length && (
          <p className="text-muted-foreground text-sm">{t("runs.noEvents")}</p>
        )}
      </div>
      {(hasDetails || onSelectDay) && (
        <div className="flex flex-wrap items-center gap-2 border-t p-2">
          {/* A stop of check requests alone has nothing to count: its details say what became of them. */}
          {counts.length ? (
            <p lang="en" className="text-muted-foreground min-w-0 text-xs">
              {reportFormat.list(counts, { type: "unit" })}
            </p>
          ) : null}
          {onSelectDay && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                onPinnedChange(false);
                onSelectDay();
              }}
            >
              {selectLabel}
            </Button>
          )}
          {hasDetails && (
            <Button
              variant="ghost"
              size="sm"
              className="ms-auto"
              onClick={() => {
                openingDetails.current = pinned;
                setOpen(false);
                onPinnedChange(false);
                onDetails();
              }}
            >
              {t("runs.details")}
              <ChevronRight />
            </Button>
          )}
        </div>
      )}
    </>
  );
  return (
    <Popover
      open={pinned}
      onOpenChange={(next) => {
        setOpen(false);
        openingDetails.current = false;
        onPinnedChange(next);
      }}
    >
      <HoverCard
        openDelay={HOVER_OPEN_MS}
        open={open && allowHover}
        onOpenChange={(next) => setOpen(next && allowHover)}
      >
        <HoverCardTrigger asChild onFocus={(event) => event.preventDefault()}>
          <PopoverTrigger asChild>{children}</PopoverTrigger>
        </HoverCardTrigger>
        {allowHover && (
          <HoverCardContent className="w-72 max-w-[calc(100vw-2rem)] p-0 text-sm">
            {preview}
          </HoverCardContent>
        )}
      </HoverCard>
      <PopoverContent
        aria-label={previewLabel}
        className="w-72 max-w-[calc(100vw-2rem)] p-0 text-sm"
        onCloseAutoFocus={(event) => {
          if (openingDetails.current) event.preventDefault();
        }}
      >
        {preview}
      </PopoverContent>
    </Popover>
  );
}

/** Everything that happened at one stop, one row per event, newest first. */
export function SeoRunDayDialog({
  workspace,
  open,
  title,
  description,
  nodes,
  checkId,
  onClose,
  onCloseAutoFocus,
}: {
  workspace: ProjectSeoWorkspace;
  open: boolean;
  /** The day of the stop. It stays while the dialog closes, so the content does not empty as it fades. */
  title: string;
  /** What the stop holds: since when, or up to when. */
  description: string;
  nodes: SeoStopNode[];
  /** The check the stop counts its issues from. A stop without one compares its newest check. */
  checkId?: string | null;
  onClose: () => void;
  /** Where focus goes when the dialog closes: it has no trigger of its own to go back to. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const diff = seoRunDiffOf(
    workspace,
    checkId ??
      seoStopCheckId(nodes) ??
      seoStopDigest(nodes).newestCheck?.observation?.id,
  );
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle lang="en">{title}</DialogTitle>
          <DialogDescription lang="en">{description}</DialogDescription>
        </DialogHeader>
        {diff ? <SeoRunDiff diff={diff} titled /> : null}
        <SeoTimeline workspace={workspace} nodes={nodes} />
      </DialogContent>
    </Dialog>
  );
}
