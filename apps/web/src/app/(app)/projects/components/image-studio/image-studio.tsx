"use client";

import { AlertTriangle, Columns2, PanelRightClose, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
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
} from "@/lib/actions/image-studio/action";
import { cn } from "@/lib/utils";

import { defaultModel, modelIdForRepeat, settingsOf } from "./catalog";
import { StudioChat } from "./studio-chat";
import { StudioComposer } from "./studio-composer";
import { StudioGallery } from "./studio-gallery";
import { StudioLightbox } from "./studio-lightbox";
import {
  isActive,
  type StudioAsset,
  type StudioFilter,
  type StudioJob,
  type StudioLabels,
  type StudioState,
  type StudioTarget,
} from "./types";
import {
  type QueuedGeneration,
  useGenerationQueue,
} from "./use-generation-queue";
import { type StudioErrorCode, useStudioState } from "./use-studio-state";

/** Which images the lightbox is showing, and why. */
type Viewing = { mode: "single" } | { mode: "compare" } | null;

/**
 * The studio.
 *
 * Gallery-first: the results are the page, the composer sits above them, and
 * the assistant is a column beside them rather than the thing you have to go
 * through. What the person is aiming at — models, placement, frame — is held
 * here rather than inside the composer, because the assistant has to be told
 * the same thing, and two copies of that state would drift.
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
  // Only for the strings that interpolate a count; see `StudioLabels`.
  const t = useTranslations("App.Projects.Detail.imageStudio");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<StudioFilter>("all");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [viewing, setViewing] = useState<Viewing>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [cancelRequestedJobIds, setCancelRequestedJobIds] = useState<string[]>(
    [],
  );
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const catalog = initialState.catalog;
  const [target, setTarget] = useState<StudioTarget>(() => {
    const model = defaultModel(catalog);
    return {
      modelIds: model ? [model.id] : [],
      placementId: null,
      settings: {
        aspectRatio: "1:1",
        resolution: "1K",
        outputFormat: "png",
        seed: null,
        placementId: null,
      },
    };
  });

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

  const {
    selectedAsset,
    selectAsset,
    state,
    activeJobs,
    refresh,
    loadOlder,
    hasOlder,
  } = studio;

  const queue = useGenerationQueue({
    projectId,
    onAccepted: useCallback(() => void refresh(), [refresh]),
  });

  const visibleAssets = useMemo(() => {
    switch (filter) {
      case "approved":
        return state.assets.filter(
          (asset) => asset.review?.decision === "APPROVED",
        );
      case "rejected":
        return state.assets.filter(
          (asset) => asset.review?.decision === "REJECTED",
        );
      case "undecided":
        return state.assets.filter((asset) => !asset.review);
      default:
        return state.assets;
    }
  }, [filter, state.assets]);

  const checkedAssets = useMemo(
    () => state.assets.filter((asset) => checkedIds.includes(asset.id)),
    [checkedIds, state.assets],
  );

  /**
   * The most recent generation that ended badly and has not been superseded.
   * Shown above the gallery so a failure is never silent.
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

  const lightboxAssets =
    viewing?.mode === "compare"
      ? checkedAssets.slice(0, 4)
      : viewing?.mode === "single" && selectedAsset
        ? [selectedAsset]
        : [];

  function handleReview(
    assetId: string,
    decision: "APPROVED" | "REJECTED",
    feedback: string,
  ) {
    setActionError(null);
    startTransition(async () => {
      try {
        await reviewImageVersion({
          projectId,
          assetId,
          decision,
          feedback: feedback.trim() === "" ? null : feedback.trim(),
        });
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : labels.failed);
      }
    });
  }

  function handleClearReview(assetId: string) {
    startTransition(async () => {
      try {
        await clearImageVersionReview({ projectId, assetId });
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : labels.failed);
      }
    });
  }

  // Keyboard review, deliberately inert while a text field has focus.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target_ = event.target as HTMLElement | null;
      if (
        !selectedAsset ||
        event.metaKey ||
        event.ctrlKey ||
        target_?.tagName === "INPUT" ||
        target_?.tagName === "TEXTAREA" ||
        target_?.isContentEditable
      ) {
        return;
      }
      if (event.key === "a") {
        event.preventDefault();
        handleReview(selectedAsset.id, "APPROVED", "");
      }
      if (event.key === "r") {
        event.preventDefault();
        handleReview(selectedAsset.id, "REJECTED", "");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAsset]);

  /**
   * Repeat a piece of work on its own terms.
   *
   * Settings come from the thing being repeated — including its placement —
   * never from a default and never from whatever is currently selected.
   * Forcing 1:1/1K turned a landscape 2K original into a square thumbnail,
   * which reads as the product ignoring the request.
   */
  function repeat(source: StudioAsset | StudioJob, from: "asset" | "job") {
    const id = crypto.randomUUID();
    const request: QueuedGeneration = {
      id,
      prompt: source.prompt,
      modelId: modelIdForRepeat(catalog, source.model) ?? "",
      modelLabel: source.model,
      settings: settingsOf(source),
      parentAssetId:
        from === "asset"
          ? (source as StudioAsset).id
          : (source as StudioJob).parentAssetId,
      referenceAssetIds:
        from === "asset"
          ? [(source as StudioAsset).id]
          : (source as StudioJob).referenceAssetIds,
      idempotencyKey: `ui:${id}`,
    };
    queue.enqueue([request]);
  }

  function handleCancelJob(jobId: string) {
    startTransition(async () => {
      try {
        const result = await requestImageJobCancel({ projectId, jobId });
        // Only that the provider accepted the request. It may still finish, so
        // nothing here treats the job as over.
        if (result.accepted) {
          setCancelRequestedJobIds((current) =>
            current.includes(jobId) ? current : [...current, jobId],
          );
        }
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : labels.failed);
      }
    });
  }

  function stepSelection(delta: number) {
    const index = visibleAssets.findIndex(
      (asset) => asset.id === selectedAsset?.id,
    );
    const next = visibleAssets[index + delta];
    if (next) selectAsset(next.id);
  }

  function errorMessage(code: StudioErrorCode | null) {
    switch (code) {
      case "session_expired":
        return labels.errorSessionExpired;
      case "refresh_failed":
        return labels.errorRefreshFailed;
      case "load_older_failed":
        return labels.errorLoadOlderFailed;
      default:
        return null;
    }
  }

  const problem =
    actionError ?? queue.lastError ?? errorMessage(studio.error) ?? null;

  return (
    <div className="min-w-0 space-y-4">
      {problem ? (
        <p
          className="border-border bg-card-background text-foreground flex items-start gap-2 rounded-lg border p-3 text-sm"
          role="status"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{problem}</span>
          {queue.lastError ? (
            <Button
              aria-label={labels.close}
              className="size-6"
              onClick={queue.clearError}
              size="icon"
              variant="ghost"
            >
              <X aria-hidden className="size-3.5" />
            </Button>
          ) : null}
        </p>
      ) : null}

      <div
        className={cn(
          "grid min-w-0 gap-4",
          chatOpen && "xl:grid-cols-[minmax(0,1fr)_24rem]",
        )}
      >
        <div className="min-w-0 space-y-4">
          <StudioComposer
            busy={pending}
            catalog={catalog}
            labels={labels}
            onClearReferences={() => setCheckedIds([])}
            onGenerate={queue.enqueue}
            onTargetChange={setTarget}
            projectId={projectId}
            referenceAssets={checkedAssets}
            target={target}
          />

          {queue.waitingForSlot ? (
            <p className="border-border bg-card-background text-muted-foreground rounded-lg border p-3 text-xs leading-relaxed">
              <span className="text-foreground font-medium">
                {labels.waitingForSlotBody}
              </span>{" "}
              {labels.queueNotDurable}
            </p>
          ) : null}

          {settledProblemJob?.retryMayDuplicateCharge ? (
            <div
              className="border-border bg-card-background rounded-lg border p-4"
              role="alert"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium">
                    {labels.uncertainTitle}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                    {labels.uncertainBody}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      onClick={() => void refresh()}
                      size="sm"
                      variant="secondary"
                    >
                      {labels.checkAgain}
                    </Button>
                    <Button
                      onClick={() => repeat(settledProblemJob, "job")}
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
                onClick={() => repeat(settledProblemJob, "job")}
                size="sm"
                variant="secondary"
              >
                {labels.tryAgain}
              </Button>
            </div>
          ) : null}

          {activeJobs.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {activeJobs.map((job) => (
                <Button
                  disabled={cancelRequestedJobIds.includes(job.id)}
                  key={job.id}
                  onClick={() => handleCancelJob(job.id)}
                  size="sm"
                  variant="ghost"
                >
                  {cancelRequestedJobIds.includes(job.id)
                    ? labels.cancelRequested
                    : `${labels.cancel} — ${job.prompt.slice(0, 32)}`}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["all", labels.filterAll],
                ["approved", labels.filterApproved],
                ["rejected", labels.filterRejected],
                ["undecided", labels.filterUndecided],
              ] as const
            ).map(([value, label]) => (
              <Button
                aria-pressed={filter === value}
                key={value}
                onClick={() => setFilter(value)}
                size="sm"
                variant={filter === value ? "secondary" : "ghost"}
              >
                {label}
              </Button>
            ))}

            <span className="grow" />

            {checkedIds.length > 0 ? (
              <>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {t("selectedCount", { count: checkedIds.length })}
                </span>
                <Button
                  disabled={checkedIds.length < 2}
                  onClick={() => setViewing({ mode: "compare" })}
                  size="sm"
                  title={
                    checkedIds.length < 2 ? labels.compareNeedsTwo : undefined
                  }
                  variant="secondary"
                >
                  <Columns2 aria-hidden />
                  {labels.compareSelected}
                </Button>
                <Button
                  onClick={() => setCheckedIds([])}
                  size="sm"
                  variant="ghost"
                >
                  {labels.clearSelection}
                </Button>
              </>
            ) : null}

            <Button
              aria-expanded={chatOpen}
              className="hidden xl:inline-flex"
              onClick={() => setChatOpen((open) => !open)}
              size="sm"
              variant="ghost"
            >
              <PanelRightClose
                aria-hidden
                className={cn(!chatOpen && "rotate-180")}
              />
              {chatOpen ? labels.chatCollapse : labels.chatExpand}
            </Button>
          </div>

          {visibleAssets.length === 0 &&
          activeJobs.length === 0 &&
          queue.queued.length === 0 ? (
            <div className="border-border bg-card-background rounded-xl border px-6 py-12 text-center">
              <h3 className="text-base font-medium">
                {filter === "all" ? labels.emptyTitle : labels.noneMatchFilter}
              </h3>
              <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm leading-relaxed">
                {labels.emptyBody}
              </p>
              {filter !== "all" ? (
                <Button
                  className="mt-3"
                  onClick={() => setFilter("all")}
                  size="sm"
                  variant="secondary"
                >
                  {labels.clearFilter}
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <StudioGallery
                activeJobs={activeJobs}
                assets={visibleAssets}
                catalog={catalog}
                labels={labels}
                onOpen={(assetId) => {
                  selectAsset(assetId);
                  setViewing({ mode: "single" });
                }}
                onToggleSelect={(assetId) =>
                  setCheckedIds((current) =>
                    current.includes(assetId)
                      ? current.filter((id) => id !== assetId)
                      : [...current, assetId],
                  )
                }
                projectId={projectId}
                queued={queue.queued}
                selectedIds={checkedIds}
              />
              {hasOlder ? (
                <Button
                  onClick={() => void loadOlder()}
                  size="sm"
                  variant="ghost"
                >
                  {labels.loadOlder}
                </Button>
              ) : null}
            </>
          )}
        </div>

        {chatOpen ? (
          // Its own scrolling column beside the gallery, and its own height on
          // desktop, so a long conversation scrolls without moving the page
          // and the composer stays where it was put.
          <aside className="h-[32rem] min-w-0 xl:sticky xl:top-4 xl:h-[calc(100dvh-9rem)]">
            <StudioChat
              catalog={catalog}
              labels={labels}
              onActivity={() => void refresh()}
              projectId={projectId}
              resumeSessionId={resumeSessionId}
              selectedAsset={selectedAsset}
              target={target}
            />
          </aside>
        ) : null}
      </div>

      {lightboxAssets.length > 0 ? (
        <StudioLightbox
          assets={lightboxAssets}
          busy={pending}
          catalog={catalog}
          labels={labels}
          onApprove={(assetId, feedback) =>
            handleReview(assetId, "APPROVED", feedback)
          }
          onClearReview={handleClearReview}
          onClose={() => setViewing(null)}
          onReject={(assetId, feedback) =>
            handleReview(assetId, "REJECTED", feedback)
          }
          onRegenerate={(asset) => repeat(asset, "asset")}
          onStep={stepSelection}
          onUseAsReference={(asset) => {
            setCheckedIds([asset.id]);
            setViewing(null);
          }}
          projectId={projectId}
          stepping={{
            hasPrevious:
              visibleAssets.findIndex(
                (asset) => asset.id === selectedAsset?.id,
              ) > 0,
            hasNext:
              visibleAssets.findIndex(
                (asset) => asset.id === selectedAsset?.id,
              ) <
              visibleAssets.length - 1,
          }}
        />
      ) : null}
    </div>
  );
}
