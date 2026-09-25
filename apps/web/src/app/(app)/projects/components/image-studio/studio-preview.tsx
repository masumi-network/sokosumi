"use client";

import {
  AlertTriangle,
  Check,
  Columns2,
  Download,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  assetContentUrl,
  type StudioAsset,
  type StudioJob,
  type StudioLabels,
} from "./types";

/**
 * The dominant region: one version, its review controls, and whatever is
 * currently happening to it.
 *
 * The failure and uncertain cards are deliberately different objects. A
 * failure offers a retry because retrying is free. An uncertain submission
 * offers no one-click retry at all — only "check again", and a second action
 * that says in words that it may be charged again.
 */
export function StudioPreview({
  asset,
  compareWith,
  labels,
  onApprove,
  onCancelJob,
  onCheckAgain,
  onClearReview,
  onRegenerate,
  onReject,
  onSubmitAnyway,
  onToggleCompare,
  pendingJobs,
  projectId,
  reviewBusy,
  settledProblemJob,
}: {
  asset: StudioAsset | null;
  compareWith: StudioAsset | null;
  labels: StudioLabels;
  onApprove: (feedback: string) => void;
  onCancelJob: (jobId: string) => void;
  onCheckAgain: () => void;
  onClearReview: () => void;
  onRegenerate: () => void;
  onReject: (feedback: string) => void;
  onSubmitAnyway: (job: StudioJob) => void;
  onToggleCompare: () => void;
  pendingJobs: StudioJob[];
  projectId: string;
  reviewBusy: boolean;
  settledProblemJob: StudioJob | null;
}) {
  const [feedback, setFeedback] = useState("");
  const decision = asset?.review?.decision ?? null;
  const inFlight = pendingJobs[0] ?? null;

  return (
    <section aria-label={labels.title} className="min-w-0 space-y-4">
      <div
        className={cn(
          "border-border bg-card-background relative overflow-hidden rounded-xl border",
          "flex items-center justify-center",
          "aspect-square md:aspect-[4/3]",
        )}
      >
        {asset ? (
          <div
            className={cn(
              "grid size-full",
              compareWith ? "grid-cols-2 gap-px" : "grid-cols-1",
            )}
          >
            {compareWith ? (
              <figure className="relative flex size-full items-center justify-center bg-black/5">
                <img
                  alt={compareWith.prompt}
                  className="max-h-full max-w-full object-contain"
                  src={assetContentUrl(projectId, compareWith.id)}
                />
                <figcaption className="absolute top-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">
                  v{compareWith.version}
                </figcaption>
              </figure>
            ) : null}
            <figure className="relative flex size-full items-center justify-center bg-black/5">
              <img
                alt={asset.prompt}
                className={cn(
                  "max-h-full max-w-full object-contain transition-opacity",
                  inFlight ? "opacity-40" : "opacity-100",
                )}
                src={assetContentUrl(projectId, asset.id)}
              />
              <figcaption className="absolute top-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">
                v{asset.version}
              </figcaption>
            </figure>
          </div>
        ) : (
          <div className="max-w-md px-6 py-10 text-center">
            <h3 className="text-base font-medium">{labels.emptyTitle}</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              {labels.emptyBody}
            </p>
          </div>
        )}

        {inFlight ? (
          <div className="bg-background/80 absolute inset-x-0 bottom-0 flex items-center gap-3 px-4 py-3 backdrop-blur">
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-sm">
              {inFlight.status === "QUEUED" || inFlight.status === "PENDING"
                ? labels.queued
                : labels.generating}
              {" — "}
              <span className="text-muted-foreground">{inFlight.prompt}</span>
            </p>
            <Button
              onClick={() => onCancelJob(inFlight.id)}
              size="sm"
              variant="ghost"
            >
              {labels.cancel}
            </Button>
          </div>
        ) : null}
      </div>

      {settledProblemJob?.retryMayDuplicateCharge ? (
        <div
          className="border-border bg-card-background rounded-lg border p-4"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium">{labels.uncertainTitle}</h3>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                {labels.uncertainBody}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={onCheckAgain} size="sm" variant="secondary">
                  {labels.checkAgain}
                </Button>
                <Button
                  onClick={() => onSubmitAnyway(settledProblemJob)}
                  size="sm"
                  variant="outline"
                >
                  {labels.submitAnyway}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : settledProblemJob ? (
        <div
          className="border-border bg-card-background rounded-lg border p-4"
          role="alert"
        >
          <h3 className="text-sm font-medium">{labels.failed}</h3>
          <p className="text-muted-foreground mt-1 text-sm break-words">
            {settledProblemJob.error ?? ""}
          </p>
          <Button
            className="mt-3"
            onClick={onRegenerate}
            size="sm"
            variant="secondary"
          >
            {labels.tryAgain}
          </Button>
        </div>
      ) : null}

      {asset ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              aria-pressed={decision === "APPROVED"}
              disabled={reviewBusy}
              onClick={() => onApprove(feedback)}
              size="sm"
              variant={decision === "APPROVED" ? "default" : "secondary"}
            >
              <Check aria-hidden />
              {labels.approve}
            </Button>
            <Button
              aria-pressed={decision === "REJECTED"}
              disabled={reviewBusy}
              onClick={() => onReject(feedback)}
              size="sm"
              variant={decision === "REJECTED" ? "default" : "secondary"}
            >
              <X aria-hidden />
              {labels.reject}
            </Button>
            {decision ? (
              <Button
                disabled={reviewBusy}
                onClick={onClearReview}
                size="sm"
                variant="ghost"
              >
                {labels.clearReview}
              </Button>
            ) : null}
            <span className="grow" />
            <Button onClick={onRegenerate} size="sm" variant="ghost">
              <RefreshCw aria-hidden />
              {labels.regenerate}
            </Button>
            <Button onClick={onToggleCompare} size="sm" variant="ghost">
              <Columns2 aria-hidden />
              {compareWith ? labels.compareOff : labels.compare}
            </Button>
            <Button asChild size="sm" variant="ghost">
              <a
                download={`v${asset.version}.png`}
                href={assetContentUrl(projectId, asset.id)}
              >
                <Download aria-hidden />
                {labels.download}
              </a>
            </Button>
          </div>

          <Textarea
            aria-label={labels.feedbackPlaceholder}
            className="min-h-16"
            onChange={(event) => setFeedback(event.currentTarget.value)}
            placeholder={labels.feedbackPlaceholder}
            value={feedback}
          />

          <p className="text-muted-foreground text-xs">
            {labels.from}: {asset.prompt}
          </p>
        </div>
      ) : null}
    </section>
  );
}
