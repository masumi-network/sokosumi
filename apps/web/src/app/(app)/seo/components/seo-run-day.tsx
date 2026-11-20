"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { ChevronRight, CircleAlert, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
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
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
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
 * Focus opens no card: the card is out of the keyboard's reach, and a tap on a phone focuses the stop. Keyboard and
 * touch reach the details of the day in view from the footer below the row.
 */
export function SeoRunDayHover({
  workspace,
  day,
  nodes,
  hint,
  onDetails,
  children,
}: {
  workspace: ProjectSeoWorkspace;
  /** The day as the stop names it. */
  day: string;
  nodes: SeoStopNode[];
  /** What a press on the stop does; none for the day in view. */
  hint: string | null;
  onDetails: () => void;
  /** The stop's own button: a press still shows the page as it was on that day. */
  children: ReactNode;
}) {
  const t = useTranslations("App.Seo");
  const report = useSeoResultTranslations("App.Seo");
  const reportFormat = useSeoResultFormatter();
  // Always controlled: a card that switched to controlled while empty would come back open with no pointer on it.
  const [open, setOpen] = useState(false);
  const digest = seoStopDigest(nodes);
  const newest = digest.newestCheck;
  const result = newest ? seoNodeResult(workspace, newest) : null;
  const coverage = newest?.observation?.coverage;
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
  return (
    // A stop with nothing to show keeps the same tree with the card shut: a new tree would remount the button and
    // drop its focus when a refetch gives the stop its events.
    <HoverCard
      openDelay={HOVER_OPEN_MS}
      open={open && nodes.length > 0}
      // Radix reports no change against a shut prop: an empty stop must not keep a wish to open.
      onOpenChange={(next) => setOpen(next && nodes.length > 0)}
    >
      {/* A handler that prevents the default keeps Radix from opening the card on focus. */}
      <HoverCardTrigger asChild onFocus={(event) => event.preventDefault()}>
        {children}
      </HoverCardTrigger>
      {nodes.length ? (
        <HoverCardContent className="w-72 p-0 text-sm">
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
            {hint ? (
              <p className="text-muted-foreground text-xs">{hint}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-3 border-t py-2 ps-4 pe-2">
            {/* A stop of check requests alone has nothing to count: its details say what became of them. */}
            {counts.length ? (
              <p lang="en" className="text-muted-foreground min-w-0 text-xs">
                {reportFormat.list(counts, { type: "unit" })}
              </p>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="ms-auto"
              onClick={onDetails}
            >
              {t("runs.details")}
              <ChevronRight />
            </Button>
          </div>
        </HoverCardContent>
      ) : null}
    </HoverCard>
  );
}

/** Everything that happened at one stop, one row per event, newest first. */
export function SeoRunDayDialog({
  workspace,
  open,
  title,
  description,
  nodes,
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
  onClose: () => void;
  /** Where focus goes when the dialog closes: it has no trigger of its own to go back to. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
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
        <SeoTimeline workspace={workspace} nodes={nodes} />
      </DialogContent>
    </Dialog>
  );
}
