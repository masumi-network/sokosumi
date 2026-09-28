"use client";

import { AlertTriangle, Columns2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  clearImageVersionReview,
  requestImageJobCancel,
  reviewImageVersion,
} from "@/lib/actions/image-studio/action";
import { cn } from "@/lib/utils";

import {
  curatedModels,
  modelIdForRepeat,
  resolveModel,
  settingsOf,
} from "./catalog";
import { STUDIO_PILL_CLASS } from "./studio-classes";
import { StudioComposer } from "./studio-composer";
import { StudioGallery } from "./studio-gallery";
import { StudioLightbox } from "./studio-lightbox";
import type { StudioTemplate } from "./studio-templates";
import {
  creditsByAssetId,
  elapsedByAssetId,
  isActive,
  type StudioAsset,
  type StudioCatalog,
  type StudioFilter,
  type StudioJob,
  type StudioLabels,
  type StudioState,
  type StudioTarget,
} from "./types";
import {
  type QueuedGeneration,
  type QueueErrorCode,
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
 * What the person is aiming at — models and frame — is still held here rather
 * than inside the composer, because the lightbox's "new variation" and the
 * gallery's reference selection both read from it.
 */
export function ImageStudio({
  catalog,
  initialSelectedAssetId,
  initialState,
  labels,
  projectId,
}: {
  /**
   * The model catalog, read once by the page.
   *
   * A prop rather than part of `initialState`, because Core took it off the
   * state payload: the studio refetches that every three seconds while
   * something is running, and the catalog is ~158KB of capabilities and prices
   * that change when fal changes, not when a job does.
   */
  catalog: StudioCatalog;
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
  /**
   * Open on the version the URL names.
   *
   * `?v=` arrives from a History row or a pasted link, and it is a promise that
   * the page shows *that* image. Selecting it was not enough: the tile carrying
   * it looks exactly like its neighbours, so in a project with a hundred
   * versions the link landed the reader in a grid with no indication of which
   * one they had asked for.
   *
   * The lightbox is what "look at this one" means in this studio, and it is
   * dismissible — closing it leaves the gallery with that version still
   * selected and scrolled to, so the deep link costs nothing when it was not
   * what somebody wanted.
   */
  const [viewing, setViewing] = useState<Viewing>(
    initialSelectedAssetId ? { mode: "single" } : null,
  );
  const [prompt, setPrompt] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
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
  const [dismissedJobIds, setDismissedJobIds] = useState<string[]>([]);

  const [target, setTarget] = useState<StudioTarget>(() => {
    // The curated five, in Core's order. Only the opening selection: every one
    // of them can be unselected, the rest of the catalog can be added, and
    // "Select all" still means all 152. Nothing below treats these five as
    // special after this line.
    return {
      modelIds: curatedModels(catalog).map((model) => model.id),
      settings: {
        aspectRatio: "1:1",
        resolution: "1K",
        outputFormat: "png",
        seed: null,
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

  /**
   * Bring the deep-linked tile onto the screen, once.
   *
   * So that dismissing the lightbox leaves the reader looking at the version
   * they followed a link to rather than at the top of the grid. Mount-only and
   * DOM-only: there is no React state for "where the gallery is scrolled to",
   * which is exactly the kind of external system an Effect is for.
   */
  useMountEffect(() => {
    if (!initialSelectedAssetId) return;
    document
      .querySelector(`[data-asset-id="${CSS.escape(initialSelectedAssetId)}"]`)
      ?.scrollIntoView({ block: "center" });
  });

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
          !dismissedJobIds.includes(job.id) &&
          (job.status === "SUBMISSION_UNCERTAIN" || job.status === "FAILED"),
      ) ?? null
    );
  }, [dismissedJobIds, state.jobs]);

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
   * Settings come from the thing being repeated, never from a default and
   * never from whatever is currently selected. Forcing 1:1/1K turned a
   * landscape 2K original into a square thumbnail, which reads as the product
   * ignoring the request.
   */
  function repeat(
    source: StudioAsset | StudioJob,
    from: "asset" | "job",
    reroll = false,
  ) {
    const id = crypto.randomUUID();
    const request: QueuedGeneration = {
      id,
      prompt: source.prompt,
      modelId: modelIdForRepeat(catalog, source.model) ?? "",
      modelLabel: source.model,
      // A re-roll is a fresh draw of the same brief: no seed, or the model
      // would hand back the picture it already made.
      settings: reroll
        ? { ...settingsOf(source), seed: null }
        : settingsOf(source),
      parentAssetId: reroll
        ? null
        : from === "asset"
          ? (source as StudioAsset).id
          : (source as StudioJob).parentAssetId,
      referenceAssetIds: reroll
        ? []
        : from === "asset"
          ? [(source as StudioAsset).id]
          : (source as StudioJob).referenceAssetIds,
      idempotencyKey: `ui:${id}`,
    };
    queue.enqueue([request]);
  }

  /**
   * Start from a template.
   *
   * It writes the brief and the frame and stops there: no submission, nothing
   * locked, and the caret goes into the prompt box, because the value of a
   * template is the edit that follows it. Undoing one is retyping — the text is
   * ordinary editable text, which is why this is not a mode.
   *
   * The frame is set unconditionally. A model that cannot honour it is already
   * clamped per leg when the batch is built (`clampToModel`), which is the same
   * rule any other frame choice goes through.
   */
  function applyTemplate(template: StudioTemplate) {
    setPrompt(template.prompt);
    setTarget((current) => ({
      ...current,
      settings: { ...current.settings, aspectRatio: template.aspectRatio },
    }));
    promptRef.current?.focus();
  }

  /** Put an image's brief and frame back in the composer, ready to edit. */
  function reusePrompt(asset: StudioAsset) {
    setPrompt(asset.prompt);
    setTarget((current) => ({
      ...current,
      settings: { ...current.settings, ...settingsOf(asset), seed: null },
    }));
    promptRef.current?.focus();
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

  function queueMessage(code: QueueErrorCode | null) {
    switch (code) {
      case "insufficient_credits":
        return labels.errorInsufficientCredits;
      case "unreachable":
        return labels.errorUnreachable;
      default:
        return null;
    }
  }

  // The queue's own code first: where this page has wording of its own, it is
  // translated, and Core's `message` is English.
  const problem =
    actionError ??
    queueMessage(queue.lastErrorCode) ??
    queue.lastError ??
    errorMessage(studio.error) ??
    null;

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

  /**
   * What each finished version was debited, from the same job rows.
   *
   * The charge, not a re-derivation of it: `creditsPerImageCents` would give the
   * price *today*, and a catalog refresh between the generation and this render
   * would quietly restate what somebody paid.
   */
  const credits = useMemo(() => creditsByAssetId(state.jobs), [state.jobs]);

  const hasWork =
    state.assets.length > 0 || activeJobs.length > 0 || queue.queued.length > 0;
  const showsNothing =
    visibleAssets.length === 0 &&
    activeJobs.length === 0 &&
    queue.queued.length === 0;

  // Chat-style feed: the scroller is `flex-col-reverse`, so scrollTop 0 is the
  // newest image and prepending older pages never moves what is on screen. The
  // top sentinel asks for the next older page as it nears the viewport.
  const topRef = useRef<HTMLDivElement>(null);
  const loadOlderRef = useRef(loadOlder);
  loadOlderRef.current = loadOlder;
  useEffect(() => {
    const node = topRef.current;
    if (!node || !hasOlder) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadOlderRef.current();
        }
      },
      { rootMargin: "400px 0px 0px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
    // Re-armed per page: a page that does not fill the viewport must fire again.
  }, [hasOlder, state.assets.length]);

  const composer = (
    <StudioComposer
      busy={pending}
      catalog={catalog}
      labels={labels}
      onApplyTemplate={applyTemplate}
      onClearReferences={() => setCheckedIds([])}
      onGenerate={queue.enqueue}
      onPromptChange={setPrompt}
      onTargetChange={setTarget}
      projectId={projectId}
      prompt={prompt}
      promptRef={promptRef}
      referenceAssets={checkedAssets}
      target={target}
    />
  );

  return (
    // One bounded column, chat-room shaped: feed scrolls, composer stays put.
    <div className="flex h-[calc(100dvh-8rem)] min-h-[28rem] min-w-0 flex-col gap-3">
      {problem ? (
        <Notice
          closeLabel={labels.close}
          onDismiss={
            queue.lastError || queue.lastErrorCode
              ? queue.clearError
              : undefined
          }
        >
          {problem}
        </Notice>
      ) : null}

      <div className="app-scrollbar flex min-h-0 flex-1 flex-col-reverse overflow-x-hidden overflow-y-auto [overflow-anchor:none]">
        <div className="flex min-h-full w-full min-w-0 shrink-0 flex-col justify-end gap-4 pb-2">
          <div ref={topRef} />
          {hasOlder ? (
            <p className="text-muted-foreground text-center text-xs">
              {labels.loadOlder}
            </p>
          ) : null}

          {showsNothing ? (
            <div className="py-6">
              <h3 className="text-sm font-medium">
                {filter === "all" ? labels.emptyTitle : labels.noneMatchFilter}
              </h3>
              <p className="text-muted-foreground mt-1 max-w-prose text-sm leading-relaxed text-pretty">
                {labels.emptyBody}
              </p>
              {filter === "all" ? null : (
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
            <StudioGallery
              activeJobs={activeJobs}
              assets={visibleAssets}
              cancelRequestedJobIds={cancelRequestedJobIds}
              catalog={catalog}
              creditsByAssetId={credits}
              elapsedByAssetId={elapsed}
              labels={labels}
              onCancelJob={handleCancelJob}
              onOpen={(assetId) => {
                selectAsset(assetId);
                setViewing({ mode: "single" });
              }}
              onReroll={(asset) => repeat(asset, "asset", true)}
              onReusePrompt={reusePrompt}
              onVariation={(asset) => repeat(asset, "asset")}
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
          )}

          {queue.waitingForSlot ? (
            <p className="text-muted-foreground text-xs leading-relaxed">
              <span className="text-foreground font-medium">
                {labels.waitingForSlotBody}
              </span>{" "}
              {labels.queueNotDurable}
            </p>
          ) : null}

          {settledProblemJob ? (
            <FailedJob
              catalog={catalog}
              job={settledProblemJob}
              labels={labels}
              onDismiss={() =>
                setDismissedJobIds((current) => [
                  ...current,
                  settledProblemJob.id,
                ])
              }
              onRefresh={() => void refresh()}
              onRetry={() => repeat(settledProblemJob, "job")}
            />
          ) : null}
        </div>
      </div>

      {hasWork ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((value) => (
              <button
                aria-pressed={filter === value}
                className={cn(
                  STUDIO_PILL_CLASS,
                  // `text-secondary-foreground`, never `text-foreground`:
                  // --secondary is the inverse of the page in both themes.
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
      ) : null}

      {composer}

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
          onSelect={selectAsset}
          onUseAsReference={(asset) => {
            setCheckedIds([asset.id]);
            setViewing(null);
          }}
          projectId={projectId}
          siblings={visibleAssets}
        />
      ) : null}
    </div>
  );
}

/**
 * A failed generation as one quiet line, not an alert.
 *
 * A sentence chosen by stable code (never the provider's transport text), the
 * model that failed, that nothing was charged, and one retry. The provider's
 * own words stay one click away for whoever has to report it.
 */
function FailedJob({
  catalog,
  job,
  labels,
  onDismiss,
  onRefresh,
  onRetry,
}: {
  catalog: StudioCatalog;
  job: StudioJob;
  labels: StudioLabels;
  onDismiss: () => void;
  onRefresh: () => void;
  onRetry: () => void;
}) {
  const uncertain = job.retryMayDuplicateCharge;
  const model = resolveModel(catalog, job.model).label;
  return (
    <div
      className="bg-card-background text-muted-foreground flex items-start gap-3 rounded-xl p-3 text-sm"
      role="status"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-foreground font-medium">
          {uncertain ? labels.uncertainTitle : `${model}: ${labels.failed}`}
        </p>
        <p className="text-pretty">
          {uncertain
            ? labels.uncertainBody
            : job.failureReason === null
              ? labels.failedBodyUnreported
              : labels.failedBody[job.failureReason]}{" "}
          {uncertain ? null : labels.failedNoCharge}
        </p>
        {job.error ? (
          <details>
            <summary className="hover:text-foreground focus-visible:ring-ring-halo w-fit cursor-pointer rounded text-xs outline-none select-none focus-visible:ring-[3px]">
              {labels.failedDetails}
            </summary>
            <p className="mt-1 font-mono text-xs break-words">{job.error}</p>
          </details>
        ) : null}
        <div className="flex gap-2 pt-1">
          {uncertain ? (
            <Button onClick={onRefresh} size="sm" variant="secondary">
              {labels.checkAgain}
            </Button>
          ) : null}
          <Button onClick={onRetry} size="sm" variant="secondary">
            {uncertain ? labels.submitAnyway : labels.tryAgain}
          </Button>
        </div>
      </div>
      <Button
        aria-label={labels.close}
        className="size-6"
        onClick={onDismiss}
        size="icon"
        variant="ghost"
      >
        <X aria-hidden className="size-3.5" />
      </Button>
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
      className="bg-card-background text-foreground flex shrink-0 items-start gap-2 rounded-xl p-3 text-sm"
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
