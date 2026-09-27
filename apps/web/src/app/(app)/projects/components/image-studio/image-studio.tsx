"use client";

import { AlertTriangle, Columns2, X } from "lucide-react";
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
import { StudioComposer } from "./studio-composer";
import { StudioGallery } from "./studio-gallery";
import { StudioLightbox } from "./studio-lightbox";
import {
  elapsedByAssetId,
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

const FILTERS: readonly StudioFilter[] = [
  "all",
  "approved",
  "rejected",
  "undecided",
];

/**
 * Whether a keypress happened somewhere a single letter means something else.
 *
 * The review shortcuts are bare letters. A Radix menu or popover uses bare
 * letters for typeahead, so opening the model menu and typing "a" to jump to
 * a model also approved whatever was selected in the gallery.
 */
function inTextOrMenu(node: HTMLElement | null): boolean {
  if (!node) return false;
  if (
    node.tagName === "INPUT" ||
    node.tagName === "TEXTAREA" ||
    node.isContentEditable
  ) {
    return true;
  }
  return Boolean(
    node.closest(
      '[data-slot="dropdown-menu-content"], [data-slot="popover-content"]',
    ),
  );
}

/**
 * The studio.
 *
 * Gallery-first: the results are the page. Above them sits one composer with
 * one obvious action, and everything that qualifies a generation is a summary
 * that opens on demand rather than a row of controls that is always there.
 *
 * There is no conversational assistant here, by design. Generating images is a
 * form — a brief, some models, a frame — and the thing worth optimising is how
 * many models one brief can reach and how quickly their results can be read
 * side by side. A chat column bought none of that and spent a quarter of the
 * width on it.
 *
 * What the person is aiming at — models, placement, frame — is still held here
 * rather than inside the composer, because the lightbox's "new variation" and
 * the gallery's reference selection both read from it.
 */
export function ImageStudio({
  initialSelectedAssetId,
  initialState,
  labels,
  projectId,
}: {
  initialSelectedAssetId: string | null;
  initialState: StudioState;
  labels: StudioLabels;
  projectId: string;
}) {
  // Only for the strings that interpolate a count; see `StudioLabels`.
  const t = useTranslations("App.Studio");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<StudioFilter>("all");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [viewing, setViewing] = useState<Viewing>(null);
  const [prompt, setPrompt] = useState("");
  const [cancelRequestedJobIds, setCancelRequestedJobIds] = useState<string[]>(
    [],
  );
  /**
   * Unsaved review notes, keyed by version and owned here rather than by the
   * lightbox.
   *
   * Closing the lightbox unmounts it, so a note typed but not yet approved
   * died the moment someone closed the details to look at the gallery, at
   * another version, or pressed "Use as reference" — which closes it too.
   * Holding the drafts above the thing that unmounts is what makes a
   * half-written note survive ordinary navigation.
   */
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
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
    applyAsset,
    refresh,
    loadOlder,
    hasOlder,
  } = studio;

  const setReviewDraft = useCallback((assetId: string, value: string) => {
    setReviewDrafts((current) => ({ ...current, [assetId]: value }));
  }, []);

  const clearReviewDraft = useCallback((assetId: string) => {
    setReviewDrafts((current) => {
      if (!(assetId in current)) return current;
      const { [assetId]: _saved, ...rest } = current;
      return rest;
    });
  }, []);

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

  /**
   * Record a decision, and keep the version that was decided on.
   *
   * The mutation's return value is the server's copy of the asset, and it is
   * folded straight into state. Relying on the refresh instead only worked
   * while reviews could target the selected version: the refresh pins that
   * one version and returns the newest page, so a decision made from
   * comparison on an older, unselected version came back in nothing, and its
   * row kept the decision it had before the save — on its pane, its gallery
   * badge, and its filter membership, through every later poll.
   */
  function handleReview(
    assetId: string,
    decision: "APPROVED" | "REJECTED",
    feedback: string,
  ) {
    setActionError(null);
    startTransition(async () => {
      try {
        const updated = await reviewImageVersion({
          projectId,
          assetId,
          decision,
          feedback: feedback.trim() === "" ? null : feedback.trim(),
        });
        applyAsset(updated);
        // The note has been accepted, so the unsaved draft is no longer
        // unsaved; dropping it lets the saved feedback show through.
        clearReviewDraft(assetId);
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : labels.failed);
      }
    });
  }

  function handleClearReview(assetId: string) {
    startTransition(async () => {
      try {
        const updated = await clearImageVersionReview({ projectId, assetId });
        applyAsset(updated);
        clearReviewDraft(assetId);
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : labels.failed);
      }
    });
  }

  // Keyboard review, deliberately inert while a text field or a menu has focus.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        !selectedAsset ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        inTextOrMenu(event.target as HTMLElement | null)
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

  const filterLabel: Record<StudioFilter, string> = {
    all: labels.filterAll,
    approved: labels.filterApproved,
    rejected: labels.filterRejected,
    undecided: labels.filterUndecided,
  };

  /**
   * How long each finished version took, from the jobs the state already
   * carries. No extra request: the studio polls jobs anyway, and the timings
   * are on the rows it gets back.
   */
  const elapsed = useMemo(() => elapsedByAssetId(state.jobs), [state.jobs]);

  const hasWork =
    state.assets.length > 0 || activeJobs.length > 0 || queue.queued.length > 0;
  const showsNothing =
    visibleAssets.length === 0 &&
    activeJobs.length === 0 &&
    queue.queued.length === 0;

  return (
    <div className="min-w-0 space-y-4">
      {problem ? (
        <Notice
          closeLabel={labels.close}
          onDismiss={queue.lastError ? queue.clearError : undefined}
        >
          {problem}
        </Notice>
      ) : null}

      <div className="min-w-0 space-y-4">
        <StudioComposer
          busy={pending}
          catalog={catalog}
          labels={labels}
          onClearReferences={() => setCheckedIds([])}
          onGenerate={queue.enqueue}
          onPromptChange={setPrompt}
          onTargetChange={setTarget}
          projectId={projectId}
          prompt={prompt}
          referenceAssets={checkedAssets}
          target={target}
        />

        {queue.waitingForSlot ? (
          <p className="text-muted-foreground px-1 text-xs leading-relaxed">
            <span className="text-foreground font-medium">
              {labels.waitingForSlotBody}
            </span>{" "}
            {labels.queueNotDurable}
          </p>
        ) : null}

        {settledProblemJob?.retryMayDuplicateCharge ? (
          <div
            className="border-border bg-background rounded-lg border p-4"
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
            className="border-border bg-background rounded-lg border p-4"
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

        {/* The gallery's own header row, in the same rhythm the overview
              uses for Briefing and Workspace. Its left-hand subject is the
              heading, so the row reads as a section rather than as a strip of
              controls. The filters join it once there is something to
              filter. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2
            className="text-muted-foreground text-xs font-medium"
            id="studio-gallery-heading"
          >
            {labels.gallery}
          </h2>

          {hasWork ? (
            <div className="flex flex-wrap items-center gap-1">
              {FILTERS.map((value) => (
                <button
                  aria-pressed={filter === value}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    "focus-visible:ring-ring-halo outline-none focus-visible:ring-[3px]",
                    // `text-secondary-foreground`, never `text-foreground`:
                    // --secondary is the inverse of the page in both themes
                    // (near-black on light, white on dark) and --foreground
                    // follows the page, so the pair rendered near-black on
                    // near-black in light mode and near-white on white in
                    // dark. The active filter was the one chip nobody could
                    // read. --secondary-foreground is the token that inverts
                    // with it.
                    filter === value
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  key={value}
                  onClick={() => setFilter(value)}
                  type="button"
                >
                  {filterLabel[value]}
                </button>
              ))}
            </div>
          ) : null}

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
        </div>

        {showsNothing ? (
          // No border and no fixed height: an empty gallery is an absence,
          // not a panel. On a project that has never generated anything it
          // offers somewhere to start instead.
          <div className="px-1 pt-2 pb-8">
            <h3 className="text-base font-medium">
              {filter === "all" ? labels.emptyTitle : labels.noneMatchFilter}
            </h3>
            <p className="text-muted-foreground mt-1 max-w-prose text-sm leading-relaxed text-pretty">
              {labels.emptyBody}
            </p>
            {filter === "all" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {labels.examplePrompts.map((example) => (
                  <button
                    className="border-border text-muted-foreground hover:text-foreground hover:border-primary-tertiary focus-visible:ring-ring-halo rounded-md border px-2.5 py-1 text-xs transition-colors outline-none focus-visible:ring-[3px]"
                    key={example}
                    onClick={() => setPrompt(example)}
                    type="button"
                  >
                    {example}
                  </button>
                ))}
              </div>
            ) : (
              <Button
                className="mt-3"
                onClick={() => setFilter("all")}
                size="sm"
                variant="secondary"
              >
                {labels.clearFilter}
              </Button>
            )}
          </div>
        ) : (
          <>
            <StudioGallery
              activeJobs={activeJobs}
              assets={visibleAssets}
              cancelRequestedJobIds={cancelRequestedJobIds}
              catalog={catalog}
              elapsedByAssetId={elapsed}
              labels={labels}
              onCancelJob={handleCancelJob}
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

      {lightboxAssets.length > 0 ? (
        <StudioLightbox
          assets={lightboxAssets}
          busy={pending}
          catalog={catalog}
          drafts={reviewDrafts}
          labels={labels}
          onApprove={(assetId, feedback) =>
            handleReview(assetId, "APPROVED", feedback)
          }
          onDraftChange={setReviewDraft}
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

/** One shape for everything that has gone wrong, wherever it came from. */
function Notice({
  children,
  closeLabel,
  onDismiss,
}: {
  children: React.ReactNode;
  closeLabel: string;
  onDismiss?: () => void;
}) {
  return (
    <p
      className="border-border bg-background text-foreground flex items-start gap-2 rounded-lg border p-3 text-sm"
      role="status"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {onDismiss ? (
        <Button
          aria-label={closeLabel}
          className="size-6"
          onClick={onDismiss}
          size="icon"
          variant="ghost"
        >
          <X aria-hidden className="size-3.5" />
        </Button>
      ) : null}
    </p>
  );
}
