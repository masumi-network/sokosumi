"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import {
  clearImageVersionReview,
  requestImageJobCancel,
  reviewImageVersion,
  startImageGeneration,
} from "@/lib/actions/image-studio/action";

import { StudioChat } from "./studio-chat";
import { StudioHistory } from "./studio-history";
import { StudioPreview } from "./studio-preview";
import { isActive, type StudioLabels, type StudioState } from "./types";
import { useStudioState } from "./use-studio-state";

type Filter = "all" | "approved";

/**
 * The studio shell.
 *
 * Holds the two pieces of state that must survive a background update — the
 * selected version and the filter — and puts the selection in the URL so a
 * reload, a back-navigation, and a shared link all land on the same image.
 */
export function ImageStudio({
  initialSelectedAssetId,
  initialState,
  labels,
  projectId,
  resumeSessionId,
}: {
  initialSelectedAssetId: string | null;
  initialState: StudioState;
  labels: StudioLabels;
  projectId: string;
  resumeSessionId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<Filter>("all");
  const [comparing, setComparing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const syncSelectionToUrl = useCallback(
    (assetId: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (assetId) next.set("v", assetId);
      else next.delete("v");
      // `replace` with scroll off: this is a view cursor, not navigation, and
      // it must not push an entry for every arrow key.
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const studio = useStudioState({
    projectId,
    initialState,
    initialSelectedAssetId,
    onSelectionChange: syncSelectionToUrl,
  });

  const { selectedAsset, selectAsset, state, activeJobs, refresh } = studio;

  const visibleAssets = useMemo(
    () =>
      filter === "approved"
        ? state.assets.filter((asset) => asset.review?.decision === "APPROVED")
        : state.assets,
    [filter, state.assets],
  );

  const parentAsset = useMemo(
    () =>
      selectedAsset?.parentId
        ? (state.assets.find((asset) => asset.id === selectedAsset.parentId) ??
          null)
        : null,
    [selectedAsset, state.assets],
  );

  /**
   * The most recent generation that ended badly and has not been superseded.
   * Shown above the review controls so a failure is never silent.
   */
  const settledProblemJob = useMemo(() => {
    const settled = state.jobs.filter((job) => !isActive(job));
    return (
      settled.find(
        (job) =>
          job.status === "SUBMISSION_UNCERTAIN" || job.status === "FAILED",
      ) ?? null
    );
  }, [state.jobs]);

  // Keyboard review, deliberately inert while a text field has focus.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        !selectedAsset ||
        event.metaKey ||
        event.ctrlKey ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.key === "a") {
        event.preventDefault();
        void handleReview("APPROVED", "");
      }
      if (event.key === "r") {
        event.preventDefault();
        void handleReview("REJECTED", "");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAsset]);

  function handleReview(decision: "APPROVED" | "REJECTED", feedback: string) {
    if (!selectedAsset) return;
    setActionError(null);
    startTransition(async () => {
      try {
        await reviewImageVersion({
          projectId,
          assetId: selectedAsset.id,
          decision,
          feedback: feedback.trim() === "" ? null : feedback.trim(),
        });
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : labels.failed);
      }
    });
  }

  function handleClearReview() {
    if (!selectedAsset) return;
    startTransition(async () => {
      try {
        await clearImageVersionReview({
          projectId,
          assetId: selectedAsset.id,
        });
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : labels.failed);
      }
    });
  }

  function handleRegenerate() {
    if (!selectedAsset) return;
    setActionError(null);
    startTransition(async () => {
      try {
        await startImageGeneration({
          projectId,
          prompt: selectedAsset.prompt,
          aspectRatio: "1:1",
          resolution: "1K",
          parentAssetId: selectedAsset.id,
          referenceAssetIds: [selectedAsset.id],
          sessionId: null,
          // New key per click: this is a deliberate second image, not a retry
          // of a request that may already be in flight.
          idempotencyKey: `ui:${crypto.randomUUID()}`,
        });
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : labels.failed);
      }
    });
  }

  function handleSubmitAnyway(job: {
    prompt: string;
    parentAssetId: string | null;
  }) {
    setActionError(null);
    startTransition(async () => {
      try {
        await startImageGeneration({
          projectId,
          prompt: job.prompt,
          aspectRatio: "1:1",
          resolution: "1K",
          parentAssetId: job.parentAssetId,
          referenceAssetIds: job.parentAssetId ? [job.parentAssetId] : [],
          sessionId: null,
          idempotencyKey: `ui:${crypto.randomUUID()}`,
        });
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : labels.failed);
      }
    });
  }

  function handleCancelJob(jobId: string) {
    startTransition(async () => {
      try {
        await requestImageJobCancel({ projectId, jobId });
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : labels.failed);
      }
    });
  }

  return (
    <div className="space-y-6">
      {studio.error || actionError ? (
        <p className="text-muted-foreground text-sm" role="status">
          {actionError ?? studio.error}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(22rem,1fr)]">
        <StudioPreview
          asset={selectedAsset}
          compareWith={comparing ? parentAsset : null}
          labels={labels}
          onApprove={(feedback) => handleReview("APPROVED", feedback)}
          onCancelJob={handleCancelJob}
          onCheckAgain={() => void refresh()}
          onClearReview={handleClearReview}
          onRegenerate={handleRegenerate}
          onReject={(feedback) => handleReview("REJECTED", feedback)}
          onSubmitAnyway={handleSubmitAnyway}
          onToggleCompare={() => setComparing((value) => !value)}
          pendingJobs={activeJobs}
          projectId={projectId}
          reviewBusy={pending}
          settledProblemJob={settledProblemJob}
        />

        <StudioChat
          labels={labels}
          onActivity={() => void refresh()}
          projectId={projectId}
          resumeSessionId={resumeSessionId}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
            size="sm"
            variant={filter === "all" ? "secondary" : "ghost"}
          >
            {labels.filterAll}
          </Button>
          <Button
            aria-pressed={filter === "approved"}
            onClick={() => setFilter("approved")}
            size="sm"
            variant={filter === "approved" ? "secondary" : "ghost"}
          >
            {labels.filterApproved}
          </Button>
        </div>

        {visibleAssets.length === 0 && activeJobs.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {filter === "approved" ? (
              <>
                {labels.noApproved}{" "}
                <button
                  className="underline underline-offset-2"
                  onClick={() => setFilter("all")}
                  type="button"
                >
                  {labels.clearFilter}
                </button>
              </>
            ) : (
              labels.emptyTitle
            )}
          </p>
        ) : (
          <StudioHistory
            activeJobs={activeJobs}
            assets={visibleAssets}
            labels={labels}
            onSelect={selectAsset}
            projectId={projectId}
            selectedAssetId={selectedAsset?.id ?? null}
          />
        )}
      </div>
    </div>
  );
}
