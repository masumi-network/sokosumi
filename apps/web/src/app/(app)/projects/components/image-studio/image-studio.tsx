"use client";

import type {
  CreateProjectVideoJobRequest,
  StudioAdHeadline,
  StudioLogoPosition,
  StudioProduct,
  StudioProductIdentity,
  StudioProductPhoto,
} from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS, productBrief } from "@sokosumi/utils";
import {
  AlertTriangle,
  ChevronDown,
  Columns2,
  Download,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { switchScopeHref } from "@/app/components/project-scope/project-scope-href";
import { openProjectScope } from "@/app/components/project-scope/sidebar-project-scope-state";
import { Button } from "@/components/ui/button";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  listStudioBatchAssets,
  prepareStudioAssetSocialMedia,
  requestImageJobCancel,
  saveStudioAdHeadline,
  startVideoGeneration,
  writeStudioAssetCaption,
} from "@/lib/actions/image-studio/action";
import { writeSocialComposePrefill } from "@/lib/social-compose-prefill";
import { cn } from "@/lib/utils";

import {
  clampToModel,
  curatedModels,
  modelById,
  modelIdForRepeat,
  resolveModel,
  settingsOf,
  supportsVariation,
  videoModelsFor,
} from "./catalog";
import {
  createStudioAdArchive,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_IMAGES,
  MAX_ARCHIVE_MIB,
  saveStudioDownload,
} from "./studio-ad-download";
import { readApprovedStudioHeadlines } from "./studio-approved-headlines";
import type {
  StudioBatchDownloadReview,
  StudioBatchProduct,
} from "./studio-batch";
import { StudioChat } from "./studio-chat";
import {
  STUDIO_COLUMN_FEED_HEIGHT_CLASS,
  STUDIO_COLUMN_MOBILE_APPLE_HEIGHT_CLASS,
  STUDIO_COLUMN_MOBILE_SHELL_CLASS,
  STUDIO_COMPOSER_GUTTER_CLASS,
} from "./studio-classes";
import { StudioComposer } from "./studio-composer";
import { StudioCreativeStart } from "./studio-creative-start";
import { StudioFailedSubmission } from "./studio-failed-submission";
import { getDistinctProviderError } from "./studio-failure-notice";
import { StudioGallery } from "./studio-gallery";
import { StudioLightbox } from "./studio-lightbox";
import { StudioLogoPositionSelect } from "./studio-logo-position-select";
import { StudioProjectToolbar } from "./studio-project-toolbar";
import { StudioTemplateCanvas } from "./studio-template-canvas";
import type { StudioBrief } from "./studio-templates";
import {
  StudioModeSwitch,
  StudioVideoComposer,
  type StudioVideoDraft,
  videoDraftFor,
} from "./studio-video-composer";
import { StudioWebsiteTools } from "./studio-website-tools";
import {
  creditsByAssetId,
  elapsedByAssetId,
  isActive,
  isVideoAsset,
  MAX_STUDIO_REFERENCES,
  type StudioAsset,
  type StudioCatalog,
  type StudioJob,
  type StudioLabels,
  type StudioState,
  type StudioTarget,
} from "./types";
import {
  type GenerationRequest,
  type QueuedGeneration,
  useGenerationQueue,
} from "./use-generation-queue";
import { type StudioErrorCode, useStudioState } from "./use-studio-state";

type VideoAspectRatio = NonNullable<
  NonNullable<CreateProjectVideoJobRequest["settings"]>["aspectRatio"]
>;

const EMPTY_STUDIO_STATE: StudioState = {
  assets: [],
  jobs: [],
  nextCursor: null,
};

/** Which images the lightbox is showing, and why. */
type Viewing = { mode: "single" } | { mode: "compare" } | null;

interface StudioCaptionDraft {
  text: string;
  suggestion?: string;
  previousText?: string;
}

/**
 * The studio.
 *
 * An empty studio offers style briefs in the center. Once generation starts,
 * results fill the feed and the styles move into the composer's toolbar. Models
 * and generation settings remain summaries that open on demand.
 *
 * There is no conversational assistant here, by design. Generating images is a
 * form — a brief, some models, a frame — and the thing worth optimising is how
 * many models one brief can reach and how quickly their results can be read
 * side by side. A chat column bought none of that and spent a quarter of the
 * width on it.
 * The ad editor is now opened on demand, beside the gallery on wide screens.
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
  projectLogo: initialProjectLogo,
  studioLogoPosition: initialLogoPosition,
  projectScopePrompt,
  websiteUrl,
  readOnly = false,
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
  /**
   * Null for the curated landing page: generation asks for its destination
   * project before anything is sent.
   */
  projectId: string | null;
  projectLogo?: string | null;
  studioLogoPosition?: StudioLogoPosition | null;
  projectScopePrompt?: React.ReactNode;
  websiteUrl?: string | null;
  /**
   * A CMO Project: CMO makes its images, so the studio shows them without a
   * composer, brand tools or draw actions (ADR 0066).
   */
  readOnly?: boolean;
}) {
  // Only for the strings that interpolate a count; see `StudioLabels`.
  const t = useTranslations("App.Studio");
  const router = useRouter();
  const pathname = usePathname();
  const isApple = useIsApplePlatform();
  const searchParams = useSearchParams();
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
  const [assistant, setAssistant] = useState<{
    open: boolean;
    asset: StudioAsset | null;
  } | null>(null);
  const assistantTriggerRef = useRef<HTMLButtonElement>(null);
  const assistantCloseRef = useRef<HTMLButtonElement>(null);
  const [prompt, setPrompt] = useState("");
  const [draftProduct, setDraftProduct] = useState<StudioProductIdentity>();
  const productDetailsRef = useRef<string | null>(null);
  const [batchProducts, setBatchProducts] = useState<StudioBatchProduct[]>([]);
  const catalogPhotoRef = useRef<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [productPhoto, setProductPhoto] = useState<StudioProductPhoto | null>(
    null,
  );
  const [hasNewerSettings, setHasNewerSettings] = useState(false);
  const [composerKey, setComposerKey] = useState(0);
  const [parentAssetId, setParentAssetId] = useState<
    string | null | undefined
  >();
  const [templateUndo, setTemplateUndo] = useState<{
    prompt: string;
    target: StudioTarget;
  } | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [cancelRequestedJobIds, setCancelRequestedJobIds] = useState<string[]>(
    [],
  );
  const [pending, startTransition] = useTransition();
  const [downloadingAds, startAdDownload] = useTransition();
  const [savedHeadlines, setSavedHeadlines] = useState<
    Record<string, StudioAdHeadline>
  >({});
  const [savingHeadline, startHeadlineSave] = useTransition();
  const headlineSaveInProgress = useRef(false);
  const [archiveLogoOverride, setArchiveLogoOverride] =
    useState<StudioLogoPosition | null>();
  const [brandKitLogo, setBrandKitLogo] = useState<{
    projectId: string;
    logo: string | null;
    position: StudioLogoPosition | null;
  }>();
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissedJobIds, setDismissedJobIds] = useState<string[]>([]);
  const [captionByAssetId, setCaptionByAssetId] = useState<
    Record<string, StudioCaptionDraft>
  >({});

  // Video: a second composer over the same gallery, shown only when Core
  // offers a video model.
  const hasVideo = catalog.videoModels.length > 0;
  const [mode, setMode] = useState<"image" | "video">("image");
  const [videoSource, setVideoSource] = useState<StudioAsset | null>(null);
  const [videoDraft, setVideoDraft] = useState<StudioVideoDraft | null>(null);
  const [videoBusy, startVideoTransition] = useTransition();
  const videoModels = videoModelsFor(catalog, videoSource ? "image" : "text");
  const activeVideoDraft =
    videoDraft && videoModels.some((model) => model.id === videoDraft.modelId)
      ? videoDraft
      : videoModels[0]
        ? videoDraftFor(videoModels[0])
        : null;

  const [target, setTarget] = useState<StudioTarget>(() => {
    // The curated five, in Core's order. Only the opening selection: every one
    // of them can be unselected, the rest of the catalog can be added, and
    // bulk selection is bounded by the 12-image purchase ceiling. Nothing
    // below treats these five as special after this line.
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
      // A saved image selection needs an explicit project scope.
      if (!projectId) return;
      const next = new URLSearchParams(searchParams.toString());
      if (assetId) next.set("v", assetId);
      else next.delete("v");
      // `replace` with scroll off: this is a view cursor, not navigation, and
      // it must not push an entry for every arrow key.
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, projectId, router, searchParams],
  );

  // Keep the queue mounted while the landing page starts work in a project.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const activeProjectId = projectId ?? pickedProjectId;
  const currentBrandLogo =
    brandKitLogo?.projectId === activeProjectId ? brandKitLogo : undefined;
  const projectLogo = currentBrandLogo
    ? currentBrandLogo.logo
    : initialProjectLogo;
  const defaultLogoPosition = currentBrandLogo
    ? currentBrandLogo.position
    : initialLogoPosition;

  const studio = useStudioState({
    projectId: activeProjectId,
    initialState: projectId ? initialState : EMPTY_STUDIO_STATE,
    initialSelectedAssetId: projectId ? initialSelectedAssetId : null,
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

  const queue = useGenerationQueue({
    onAccepted: useCallback(
      ({ remaining }: { remaining: number }) => {
        void refresh();
        // Work started from "Everything" belongs to the project it was sent
        // to: once the last request is in, the page moves there, so the
        // sidebar's project switcher says where you are. Not before, because
        // the page remounts per project and would drop what is still queued.
        if (projectId === null && pickedProjectId && remaining === 0)
          router.replace(switchScopeHref(pathname, pickedProjectId), {
            scroll: false,
          });
      },
      [refresh, projectId, pickedProjectId, router, pathname],
    ),
  });

  const checkedAssets = useMemo(
    () =>
      checkedIds.flatMap((id) => {
        const asset = state.assets.find((asset) => asset.id === id);
        return asset ? [asset] : [];
      }),
    [checkedIds, state.assets],
  );
  const referenceProjectIds = new Set(
    checkedAssets.map(({ projectId }) => projectId),
  );
  const generationProjectId =
    referenceProjectIds.size > 1
      ? null
      : ([...referenceProjectIds][0] ?? activeProjectId);

  function archiveLimitFor(assets: StudioAsset[]) {
    if (assets.length > MAX_ARCHIVE_IMAGES)
      return t("archiveImageLimit", { count: MAX_ARCHIVE_IMAGES });
    if (assets.reduce((sum, asset) => sum + asset.bytes, 0) > MAX_ARCHIVE_BYTES)
      return t("archiveSizeLimit", { size: MAX_ARCHIVE_MIB });
    return null;
  }

  const archiveLimit = archiveLimitFor(checkedAssets);
  const canBrandArchive =
    Boolean(projectLogo) &&
    checkedAssets.length > 1 &&
    checkedAssets.every(
      (asset) => asset.projectId === activeProjectId && !isVideoAsset(asset),
    );

  const archiveLogo = canBrandArchive
    ? archiveLogoOverride === undefined
      ? (defaultLogoPosition ?? undefined)
      : (archiveLogoOverride ?? undefined)
    : undefined;

  function handleDownloadAds() {
    if (
      downloadingAds ||
      headlineSaveInProgress.current ||
      archiveLimit ||
      checkedAssets.length < 2
    )
      return;
    startAdDownload(async () => {
      try {
        await downloadArchive(
          checkedAssets,
          archiveLogo ? "studio-branded-ads.zip" : "studio-ads.zip",
          archiveLogo,
        );
      } catch {
        toast.error(
          t(archiveLogo ? "brandExportFailed" : "archiveDownloadFailed"),
        );
      }
    });
  }

  function headlineForAsset(asset: StudioAsset) {
    const saved = savedHeadlines[asset.id];
    const latest =
      saved && saved.revision > (asset.headline?.revision ?? 0)
        ? saved
        : asset.headline;
    return latest?.text ?? "";
  }

  function rememberHeadlines(
    updates: { assetId: string; headline: StudioAdHeadline }[],
  ) {
    if (!updates.length) return;
    setSavedHeadlines((current) => {
      const next = { ...current };
      for (const { assetId, headline } of updates) {
        if ((next[assetId]?.revision ?? -1) < headline.revision) {
          next[assetId] = headline;
        }
      }
      return next;
    });
  }

  function changeHeadline(asset: StudioAsset, text: string) {
    if (headlineSaveInProgress.current || downloadingAds) return;
    headlineSaveInProgress.current = true;
    startHeadlineSave(async () => {
      try {
        const saved = await saveStudioAdHeadline({
          projectId: asset.projectId,
          assetId: asset.id,
          text: text || null,
        });
        rememberHeadlines([{ assetId: asset.id, headline: saved }]);
      } catch {
        toast.error(t("headlineSaveFailed"));
      } finally {
        headlineSaveInProgress.current = false;
      }
    });
  }

  async function downloadArchive(
    assets: StudioAsset[],
    filename: string,
    logo?: StudioLogoPosition,
  ) {
    const reviewedAssets = assets.flatMap((asset) => {
      const text = isVideoAsset(asset) ? "" : headlineForAsset(asset);
      return text ? [{ id: asset.id, projectId: asset.projectId, text }] : [];
    });
    const reviewedProjects = [
      ...new Set(reviewedAssets.map(({ projectId }) => projectId)),
    ];
    const approvals = new Map(
      await Promise.all(
        reviewedProjects.map(
          async (projectId) =>
            [projectId, await readApprovedStudioHeadlines(projectId)] as const,
        ),
      ),
    );
    if (
      reviewedAssets.some(
        ({ text, projectId }) => !approvals.get(projectId)?.includes(text),
      )
    ) {
      toast.error(t("archiveHeadlineRemoved"));
      return;
    }
    const archive = reviewedAssets.length
      ? await createStudioAdArchive(
          assets,
          logo,
          Object.fromEntries(reviewedAssets.map(({ id, text }) => [id, text])),
        )
      : await createStudioAdArchive(assets, logo);
    saveStudioDownload(
      new Blob([archive], { type: "application/zip" }),
      filename,
    );
  }

  function handleDownloadBatch(
    { projectId, batchId }: StudioAsset,
    logo?: StudioLogoPosition,
    review?: StudioBatchDownloadReview,
  ) {
    if (downloadingAds || headlineSaveInProgress.current || !batchId) return;
    startAdDownload(async () => {
      try {
        const assets = await listStudioBatchAssets({ projectId, batchId });
        if (review) {
          const reviewedHeadlines = new Map(
            review.assets.map((asset) => [asset.id, headlineForAsset(asset)]),
          );
          if (
            assets.length !== review.assets.length ||
            assets.some(
              (asset) =>
                reviewedHeadlines.get(asset.id) !== headlineForAsset(asset),
            )
          ) {
            review.onChanged();
            return;
          }
        }
        const limit = archiveLimitFor(assets);
        if (limit) {
          toast.error(limit);
          return;
        }
        await downloadArchive(
          assets,
          logo ? "studio-branded-ad-batch.zip" : "studio-ad-batch.zip",
          logo,
        );
      } catch {
        toast.error(t(logo ? "brandExportFailed" : "archiveDownloadFailed"));
      }
    });
  }

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

  async function scheduleAsset(asset: StudioAsset) {
    const result = await prepareStudioAssetSocialMedia({
      projectId: asset.projectId,
      assetId: asset.id,
    });
    if (!result.ok) {
      toast.error(labels.scheduleFailed);
      return;
    }
    const text = captionByAssetId[asset.id]?.text.trim();
    writeSocialComposePrefill(asset.projectId, {
      media: [result.value],
      ...(text ? { text } : {}),
    });
    router.push(
      `/social?projectId=${encodeURIComponent(asset.projectId)}&compose=new`,
    );
  }

  async function writeCaption(asset: StudioAsset) {
    const textAtStart = captionByAssetId[asset.id]?.text;
    const result = await writeStudioAssetCaption({
      projectId: asset.projectId,
      assetId: asset.id,
    });
    if (!result.ok) {
      toast.error(labels.writeCaptionFailed);
      return;
    }
    setCaptionByAssetId((current) => {
      const caption = current[asset.id];
      // Offer replacements; even clearing the text while waiting is an edit.
      const preserveText =
        caption?.text.trim() || caption?.text !== textAtStart;
      return {
        ...current,
        [asset.id]: preserveText
          ? {
              ...caption,
              text: caption?.text ?? "",
              suggestion: result.value.text,
            }
          : { text: result.value.text },
      };
    });
  }

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
    if (
      from === "asset" &&
      !reroll &&
      !supportsVariation(catalog, source.model)
    )
      return;
    const id = crypto.randomUUID();
    const job = from === "job" ? (source as StudioJob) : null;
    const inheritsCutout = job?.useProductCutout && job.parentAssetId !== null;
    const request: QueuedGeneration = {
      id,
      // Whatever it repeats already lives in a project, and Core only accepts
      // references from the project the generation runs in.
      projectId: source.projectId,
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
      ...(source.product ? { product: source.product } : {}),
      ...(!reroll && !inheritsCutout && job?.referenceFileIds?.length
        ? { referenceFileIds: job.referenceFileIds }
        : {}),
      ...(!reroll && !inheritsCutout && job?.useProductCutout
        ? { useProductCutout: true }
        : {}),
      idempotencyKey: `ui:${id}`,
    };
    queue.enqueue([request]);
  }

  /**
   * Start from a template.
   *
   * It writes the brief and the frame and stops there: no submission, nothing
   * locked, and the caret goes into the prompt box, because the value of a
   * template is the edit that follows it. Replacing a typed brief keeps one
   * undo snapshot until the next edit, settings change, or submission.
   *
   * The frame is set unconditionally. A model that cannot honour it is already
   * clamped per leg when the batch is built (`clampToModel`), which is the same
   * rule any other frame choice goes through.
   */
  function applyTemplate(template: StudioBrief) {
    setHasNewerSettings(true);
    setTemplateUndo(
      (current) => current ?? (prompt.trim() ? { prompt, target } : null),
    );
    const details = productDetailsRef.current;
    setPrompt(
      details && prompt.endsWith(details)
        ? `${template.prompt}\n\n${details}`
        : template.prompt,
    );
    setTarget((current) => ({
      ...current,
      placementRatios: undefined,
      settings: { ...current.settings, aspectRatio: template.aspectRatio },
    }));
    if (mode === "video") {
      setMode("image");
      setVideoSource(null);
      requestAnimationFrame(() => promptRef.current?.focus());
    } else {
      promptRef.current?.focus();
    }
  }

  function useProduct(
    product: StudioProduct,
    photo: StudioProductPhoto | null,
  ) {
    setBatchProducts([]);
    setDraftProduct({ id: product.id, name: product.name });
    const previousPhotoId = catalogPhotoRef.current;
    catalogPhotoRef.current = photo?.id ?? null;
    setProductPhoto(
      (current) => photo ?? (current?.id === previousPhotoId ? null : current),
    );
    const details = productBrief(product);
    setMode("image");
    setHasNewerSettings(true);
    setTemplateUndo(null);
    const previousDetails = productDetailsRef.current;
    productDetailsRef.current = details;
    setPrompt((current) => {
      const rest =
        previousDetails && current.endsWith(previousDetails)
          ? current.slice(0, -previousDetails.length).trim()
          : current.trim();
      return [rest, details].filter(Boolean).join("\n\n");
    });
    requestAnimationFrame(() => promptRef.current?.focus());
  }

  function useProductBatch(products: StudioBatchProduct[]) {
    const previousDetails = productDetailsRef.current;
    productDetailsRef.current = null;
    catalogPhotoRef.current = null;
    setProductPhoto(null);
    setDraftProduct(undefined);
    setBatchProducts(products);
    setMode("image");
    setHasNewerSettings(true);
    setTemplateUndo(null);
    setPrompt((current) =>
      previousDetails && current.endsWith(previousDetails)
        ? current.slice(0, -previousDetails.length).trim()
        : current,
    );
    requestAnimationFrame(() => promptRef.current?.focus());
  }

  /** Put an image's brief and frame back in the composer, ready to edit. */
  function reusePrompt(asset: StudioAsset) {
    setBatchProducts([]);
    setDraftProduct(asset.product);
    setHasNewerSettings(true);
    setTemplateUndo(null);
    setPrompt(asset.prompt);
    setTarget((current) => ({
      ...current,
      creativeDirection: undefined,
      placementRatios: undefined,
      settings: { ...current.settings, ...settingsOf(asset), seed: null },
    }));
    promptRef.current?.focus();
  }

  /**
   * A batch from the composer, aimed at a project.
   *
   * References decide it when there are any, since Core takes them only from
   * the project the generation runs in. Otherwise the open project does, and
   * in the workspace view the batch waits while the person picks one in the
   * header's project selector. Closing it leaves the brief untouched.
   */
  function handleGenerate(requests: GenerationRequest[]) {
    setTemplateUndo(null);
    if (referenceProjectIds.size > 1) {
      setActionError(t("referencesAcrossProjects"));
      return;
    }
    if (generationProjectId) {
      const headlines = requests.flatMap(({ exportHeadline }) =>
        exportHeadline ? [exportHeadline] : [],
      );
      if (headlines.length) {
        setActionError(null);
        startTransition(async () => {
          try {
            const approved =
              await readApprovedStudioHeadlines(generationProjectId);
            if (headlines.some((line) => !approved.includes(line))) {
              setTarget((current) => ({
                ...current,
                exportHeadlines: undefined,
              }));
              setActionError(t("campaignHeadlineRemoved"));
              return;
            }
            sendTo(generationProjectId, requests);
          } catch {
            setActionError(t("headlineLoadFailed"));
          }
        });
      } else {
        sendTo(generationProjectId, requests);
      }
      return;
    }
    openProjectScope({
      required: true,
      reason: t("pickForGeneration"),
      excludeCmo: true,
      onSelect: (picked) => {
        setPickedProjectId(picked);
        sendTo(picked, requests);
      },
    });
  }

  function sendTo(target: string, requests: GenerationRequest[]) {
    setTemplateUndo(null);
    setActionError(null);
    const batchId = requests.length > 1 ? crypto.randomUUID() : undefined;
    queue.enqueue(
      requests.map((request) => ({
        ...request,
        projectId: target,
        ...(batchId ? { batchId } : {}),
      })),
    );
    setPrompt((current) => (current === prompt ? "" : current));
    setBatchProducts((current) => (current === batchProducts ? [] : current));
    setDraftProduct((current) =>
      current === draftProduct ? undefined : current,
    );
    setHasNewerSettings(false);
  }

  function canEditRequest(request: QueuedGeneration) {
    const model = modelById(catalog, request.modelId);
    if (uploadingPhoto || !model || request.projectId !== activeProjectId)
      return false;
    const { referenceAssetIds, referenceFileIds, parentAssetId, settings } =
      request;
    const referenceCount =
      referenceAssetIds.length +
      (request.useProductCutout ? 0 : (referenceFileIds?.length ?? 0));
    if (
      referenceCount > MAX_STUDIO_REFERENCES ||
      (referenceFileIds?.length ?? 0) > 1 ||
      referenceAssetIds.some(
        (id) =>
          !state.assets.some(
            (asset) => asset.id === id && asset.projectId === request.projectId,
          ),
      ) ||
      (parentAssetId !== null &&
        !state.assets.some(
          (asset) =>
            asset.id === parentAssetId && asset.projectId === request.projectId,
        )) ||
      (referenceCount > 0 &&
        (!model.editEndpoint || model.maxReferences < referenceCount))
    ) {
      return false;
    }
    const restored = clampToModel(model, settings);
    return (
      restored.aspectRatio === settings.aspectRatio &&
      restored.resolution === settings.resolution &&
      restored.outputFormat === settings.outputFormat &&
      (restored.seed ?? null) === (settings.seed ?? null)
    );
  }

  function clearReferences() {
    setArchiveLogoOverride(undefined);
    setTemplateUndo(null);
    setCheckedIds([]);
    setParentAssetId(undefined);
    setHasNewerSettings(true);
  }

  function handleCancelJob(jobId: string) {
    const job = state.jobs.find((candidate) => candidate.id === jobId);
    if (!job) return;
    startTransition(async () => {
      try {
        const result = await requestImageJobCancel({
          projectId: job.projectId,
          jobId,
        });
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

  /** Open the video composer on a gallery image. */
  function animate(asset: StudioAsset) {
    setVideoSource(asset);
    setVideoDraft(null);
    setMode("video");
    setViewing(null);
    requestAnimationFrame(() => promptRef.current?.focus());
  }

  function handleGenerateVideo() {
    const projectForVideo = videoSource?.projectId ?? activeProjectId;
    if (!projectForVideo || !activeVideoDraft) return;
    const brief = prompt.trim();
    // One key per press, reused if the same press is retried.
    const idempotencyKey = `ui:${crypto.randomUUID()}`;
    setActionError(null);
    startVideoTransition(async () => {
      const result = await startVideoGeneration({
        projectId: projectForVideo,
        modelId: activeVideoDraft.modelId,
        prompt: brief,
        settings: {
          durationSeconds: activeVideoDraft.settings.durationSeconds,
          resolution: activeVideoDraft.settings.resolution,
          // Empty for an image-to-video model: its frame is the still's.
          ...(activeVideoDraft.settings.aspectRatio
            ? {
                aspectRatio: activeVideoDraft.settings
                  .aspectRatio as VideoAspectRatio,
              }
            : {}),
        },
        sourceAssetId: videoSource?.id ?? null,
        sessionId: null,
        idempotencyKey,
      });
      if (!result.ok) {
        setActionError(
          result.kind === CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE
            ? labels.errorInsufficientCredits
            : result.message,
        );
        return;
      }
      setPrompt("");
      await refresh();
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

  const problem = actionError ?? errorMessage(studio.error) ?? null;

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

  const showsNothing =
    state.assets.length === 0 &&
    activeJobs.length === 0 &&
    queue.queued.length === 0 &&
    queue.failed.length === 0;

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

  const dock = useSteadyDock(promptRef, showsNothing);
  const assistantOpen = assistant?.open === true;

  function openAssistant(asset: StudioAsset | null) {
    setAssistant({ open: true, asset });
    setViewing(null);
    requestAnimationFrame(() => assistantCloseRef.current?.focus());
  }

  function closeAssistant() {
    setAssistant((current) => (current ? { ...current, open: false } : null));
    requestAnimationFrame(() => assistantTriggerRef.current?.focus());
  }

  const modeSwitch = hasVideo ? (
    <StudioModeSwitch
      labels={labels}
      mode={mode}
      onModeChange={(next) => {
        setMode(next);
        if (next === "image") setVideoSource(null);
      }}
    />
  ) : null;

  const composer =
    mode === "video" && activeVideoDraft ? (
      <StudioVideoComposer
        busy={videoBusy}
        canGenerate={(videoSource?.projectId ?? activeProjectId) !== null}
        catalog={catalog}
        draft={activeVideoDraft}
        labels={labels}
        modeSwitch={modeSwitch}
        onClearSource={() => {
          setVideoSource(null);
          setVideoDraft(null);
        }}
        onDraftChange={setVideoDraft}
        onGenerate={handleGenerateVideo}
        onPromptChange={(value) => {
          setTemplateUndo(null);
          setPrompt(value);
        }}
        prompt={prompt}
        promptRef={promptRef}
        source={videoSource}
      />
    ) : (
      <StudioComposer
        key={composerKey}
        modeSwitch={modeSwitch}
        busy={pending}
        catalog={catalog}
        generationProjectId={generationProjectId}
        labels={labels}
        onApplyTemplate={applyTemplate}
        onClearReferences={clearReferences}
        onCopiesChange={() => {
          setTemplateUndo(null);
          setHasNewerSettings(true);
        }}
        onGenerate={handleGenerate}
        onProductPhotoChange={(photo) => {
          setProductPhoto(photo);
          setTemplateUndo(null);
          setHasNewerSettings(true);
        }}
        productPhoto={productPhoto}
        product={draftProduct}
        batchProducts={batchProducts}
        onClearProductBatch={() => {
          setBatchProducts([]);
          setHasNewerSettings(true);
        }}
        uploadingPhoto={uploadingPhoto}
        onPhotoUploadChange={setUploadingPhoto}
        onPromptChange={(value) => {
          setTemplateUndo(null);
          setPrompt(value);
        }}
        onTargetChange={(update) => {
          setTemplateUndo(null);
          setTarget(update);
          setHasNewerSettings(true);
        }}
        parentAssetId={parentAssetId}
        prompt={prompt}
        promptRef={promptRef}
        referenceAssets={checkedAssets}
        target={target}
        onUndoTemplate={
          templateUndo
            ? () => {
                setPrompt(templateUndo.prompt);
                setTarget(templateUndo.target);
                setTemplateUndo(null);
                promptRef.current?.focus();
              }
            : undefined
        }
      />
    );

  const studioColumn = (
    <div
      className={cn(
        "min-h-0 min-w-0 flex-1 flex-col",
        assistantOpen ? "hidden lg:flex" : "flex",
        showsNothing &&
          "relative isolate overflow-y-auto max-md:overflow-y-auto",
      )}
    >
      {showsNothing && !readOnly ? (
        <StudioTemplateCanvas labels={labels} onApplyTemplate={applyTemplate} />
      ) : null}
      {problem ? <Notice closeLabel={labels.close}>{problem}</Notice> : null}
      {activeProjectId && !readOnly ? (
        <StudioProjectToolbar
          assistantControls={assistant ? "studio-assistant-panel" : undefined}
          assistantOpen={assistantOpen}
          assistantTriggerRef={assistantTriggerRef}
          onAssistantToggle={() => {
            if (assistantOpen) closeAssistant();
            else openAssistant(assistant?.asset ?? null);
          }}
        >
          <StudioWebsiteTools
            key={activeProjectId}
            canUseProduct={!uploadingPhoto}
            onLogoChange={(logo, position) =>
              setBrandKitLogo({ projectId: activeProjectId, logo, position })
            }
            onUseProduct={useProduct}
            onUseBatch={useProductBatch}
            projectId={activeProjectId}
            websiteUrl={websiteUrl}
          />
        </StudioProjectToolbar>
      ) : null}

      <div
        className={cn(
          showsNothing
            ? "pointer-events-none mt-auto"
            : "app-scrollbar flex min-h-0 flex-1 flex-col-reverse overflow-x-hidden overflow-y-auto [overflow-anchor:none]",
        )}
      >
        <div
          className={cn(
            "flex min-h-full w-full min-w-0 shrink-0 flex-col gap-4 pb-2",
            // The column cancels the page pad so the prompt docks to the
            // edge; the gallery takes the composer's gutter back. The empty
            // state's artwork stays edge to edge on purpose.
            showsNothing
              ? "justify-center"
              : cn("justify-end", STUDIO_COMPOSER_GUTTER_CLASS),
          )}
        >
          <div ref={topRef} />
          {hasOlder ? (
            <p className="text-muted-foreground text-center text-xs">
              {labels.loadOlder}
            </p>
          ) : null}

          {showsNothing ? (
            <div className="space-y-2 px-4 pt-8 text-center">
              <h2 className="text-foreground text-3xl font-semibold text-balance">
                {labels.emptyTitle}
              </h2>
              <p className="text-muted-foreground text-sm text-pretty">
                {labels.emptyBody}
              </p>
              <div className="pointer-events-auto inline-flex flex-wrap items-center justify-center gap-2">
                {projectScopePrompt}
                {readOnly ? null : (
                  <StudioCreativeStart
                    onApplyBrief={applyTemplate}
                    onFocusPrompt={() => promptRef.current?.focus()}
                  />
                )}
              </div>
            </div>
          ) : (
            <StudioGallery
              activeJobs={activeJobs}
              assets={state.assets}
              cancelRequestedJobIds={cancelRequestedJobIds}
              catalog={catalog}
              labels={labels}
              onCancelJob={readOnly ? undefined : handleCancelJob}
              onOpen={(assetId) => {
                selectAsset(assetId);
                setViewing({ mode: "single" });
              }}
              onReroll={
                readOnly ? undefined : (asset) => repeat(asset, "asset", true)
              }
              onReusePrompt={readOnly ? undefined : reusePrompt}
              onVariation={
                readOnly ? undefined : (asset) => repeat(asset, "asset")
              }
              onToggleSelect={(assetId) => {
                setTemplateUndo(null);
                setParentAssetId(undefined);
                setHasNewerSettings(true);
                setCheckedIds((current) =>
                  current.includes(assetId)
                    ? current.filter((id) => id !== assetId)
                    : [...current, assetId],
                );
              }}
              queued={queue.queued}
              selectedIds={checkedIds}
            />
          )}

          {queue.failed.map((failure) => (
            <StudioFailedSubmission
              key={failure.request.id}
              failure={failure}
              hasNewerDraft={prompt.trim().length > 0 || hasNewerSettings}
              labels={labels}
              onDismiss={() => queue.dismissFailed(failure.request.id)}
              onRetry={() => queue.retry(failure.request.id)}
              onEdit={
                canEditRequest(failure.request)
                  ? () => {
                      if (prompt.trim().length > 0 || hasNewerSettings) return;
                      const { request } = failure;
                      setBatchProducts([]);
                      setDraftProduct(request.product);
                      setTemplateUndo(null);
                      setPrompt(request.prompt);
                      setTarget({
                        modelIds: [request.modelId],
                        settings: request.settings,
                        useProductCutout: request.useProductCutout,
                        ...(request.exportHeadline
                          ? {
                              exportHeadlines: {
                                projectId: request.projectId,
                                lines: [request.exportHeadline],
                              },
                            }
                          : {}),
                      });
                      setCheckedIds(request.referenceAssetIds);
                      const photoId = request.referenceFileIds?.[0];
                      setProductPhoto((current) => {
                        if (!photoId) return null;
                        if (current?.id === photoId) return current;
                        return { id: photoId, name: t("productPhoto") };
                      });
                      setParentAssetId(request.parentAssetId);
                      setHasNewerSettings(true);
                      // A saved failure is one leg, even if its batch had copies.
                      setComposerKey((current) => current + 1);
                      queue.dismissFailed(request.id);
                      requestAnimationFrame(() => promptRef.current?.focus());
                    }
                  : undefined
              }
            />
          ))}

          {queue.failed.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              {t("savedRequestsInTab")}
            </p>
          ) : null}

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

      {checkedIds.length > 0 ? (
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-2",
            STUDIO_COMPOSER_GUTTER_CLASS,
          )}
        >
          <span className="grow" />
          <span className="text-muted-foreground text-xs tabular-nums">
            {t("selectedCount", { count: checkedIds.length })}
          </span>
          <Button
            disabled={checkedIds.length < 2}
            onClick={() => setViewing({ mode: "compare" })}
            size="sm"
            title={checkedIds.length < 2 ? labels.compareNeedsTwo : undefined}
            variant="secondary"
          >
            <Columns2 aria-hidden />
            {labels.compareSelected}
          </Button>
          {checkedAssets.length > 1 ? (
            <Button
              aria-describedby={
                archiveLimit ? "studio-archive-limit" : undefined
              }
              aria-disabled={archiveLimit ? true : undefined}
              disabled={savingHeadline}
              loading={downloadingAds}
              onClick={handleDownloadAds}
              size="sm"
              variant="secondary"
            >
              <Download aria-hidden />
              {t("downloadAdsZip")}
            </Button>
          ) : null}
          {canBrandArchive ? (
            <StudioLogoPositionSelect
              disabled={downloadingAds}
              label={t("archiveLogoPosition")}
              onChange={(position) => setArchiveLogoOverride(position ?? null)}
              value={archiveLogo}
            />
          ) : null}
          {archiveLimit ? (
            <p
              className="text-muted-foreground basis-full text-right text-xs"
              id="studio-archive-limit"
            >
              {archiveLimit}
            </p>
          ) : null}
          <Button onClick={clearReferences} size="sm" variant="ghost">
            {labels.clearSelection}
          </Button>
        </div>
      ) : null}

      <div
        className={cn(
          "relative shrink-0",
          showsNothing && "mx-auto mb-auto w-full max-w-3xl pb-14",
        )}
        ref={dock.slotRef}
      >
        <div
          className={cn(
            "pt-2",
            !showsNothing && "bg-background absolute inset-x-0 bottom-0",
          )}
          ref={dock.dockRef}
        >
          {readOnly ? null : composer}
        </div>
      </div>

      {lightboxAssets.length > 0 ? (
        <StudioLightbox
          assets={lightboxAssets}
          catalog={catalog}
          creditsByAssetId={credits}
          elapsedByAssetId={elapsed}
          defaultLogoPosition={defaultLogoPosition}
          labels={labels}
          projectLogo={
            lightboxAssets[0]?.projectId === activeProjectId
              ? projectLogo
              : undefined
          }
          onAnimate={
            !readOnly && videoModelsFor(catalog, "image").length > 0
              ? animate
              : undefined
          }
          onClose={() => setViewing(null)}
          onDownloadBatch={handleDownloadBatch}
          downloadingBatch={downloadingAds}
          headlineForAsset={headlineForAsset}
          savingHeadline={savingHeadline}
          onHeadlineChange={readOnly ? undefined : changeHeadline}
          onEditWithAssistant={
            activeProjectId && !readOnly ? openAssistant : undefined
          }
          editWithAssistantLabel={t("Assistant.edit")}
          onRegenerate={
            readOnly ? undefined : (asset) => repeat(asset, "asset")
          }
          onSchedule={readOnly ? undefined : scheduleAsset}
          onSelect={selectAsset}
          onUseAsReference={
            readOnly
              ? undefined
              : (asset) => {
                  setBatchProducts([]);
                  setDraftProduct(asset.product);
                  setParentAssetId(undefined);
                  setHasNewerSettings(true);
                  setTemplateUndo(null);
                  setCheckedIds([asset.id]);
                  setPrompt("");
                  setTarget((current) => ({
                    ...current,
                    creativeDirection: undefined,
                    placementRatios: undefined,
                    settings: { ...settingsOf(asset), seed: null },
                  }));
                  setViewing(null);
                  requestAnimationFrame(() => promptRef.current?.focus());
                }
          }
          onWriteCaption={readOnly ? undefined : writeCaption}
          caption={
            lightboxAssets.length === 1
              ? captionByAssetId[lightboxAssets[0].id]?.text
              : undefined
          }
          captionSuggestion={
            lightboxAssets.length === 1
              ? captionByAssetId[lightboxAssets[0].id]?.suggestion
              : undefined
          }
          onCaptionSuggestionResolve={(useSuggestion) => {
            const asset = lightboxAssets[0];
            if (!asset) return;
            setCaptionByAssetId((current) => {
              const caption = current[asset.id];
              if (caption?.suggestion === undefined) return current;
              return {
                ...current,
                [asset.id]: useSuggestion
                  ? { text: caption.suggestion, previousText: caption.text }
                  : { ...caption, suggestion: undefined },
              };
            });
          }}
          onUndoCaption={
            lightboxAssets.length === 1 &&
            captionByAssetId[lightboxAssets[0].id]?.previousText !== undefined
              ? () => {
                  const assetId = lightboxAssets[0].id;
                  setCaptionByAssetId((current) => {
                    const caption = current[assetId];
                    if (caption?.previousText === undefined) return current;
                    return {
                      ...current,
                      [assetId]: {
                        ...caption,
                        text: caption.previousText,
                        previousText: undefined,
                      },
                    };
                  });
                }
              : undefined
          }
          onCaptionChange={(text) => {
            const asset = lightboxAssets[0];
            if (!asset) return;
            setCaptionByAssetId((current) => ({
              ...current,
              [asset.id]: {
                ...current[asset.id],
                text,
                previousText: undefined,
              },
            }));
          }}
          siblings={state.assets}
        />
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        "flex min-w-0",
        STUDIO_COLUMN_MOBILE_SHELL_CLASS,
        isApple && STUDIO_COLUMN_MOBILE_APPLE_HEIGHT_CLASS,
        STUDIO_COLUMN_FEED_HEIGHT_CLASS,
      )}
    >
      {studioColumn}
      {assistant && activeProjectId ? (
        <aside
          aria-labelledby="studio-assistant-heading"
          className={cn(
            "border-border bg-card-background min-h-0 min-w-0 w-full flex-col lg:w-96 lg:shrink-0 lg:border-l",
            assistantOpen ? "flex" : "hidden",
          )}
          id="studio-assistant-panel"
          hidden={!assistantOpen}
        >
          <div className="border-border flex items-center justify-between gap-2 border-b px-4 py-2">
            <h2 className="text-sm font-medium" id="studio-assistant-heading">
              {t("Assistant.title")}
            </h2>
            <Button
              aria-label={labels.close}
              onClick={closeAssistant}
              ref={assistantCloseRef}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X aria-hidden />
            </Button>
          </div>
          <StudioChat
            assets={state.assets}
            key={activeProjectId}
            labels={labels}
            onActivity={(updates) => {
              rememberHeadlines(updates);
              void refresh();
            }}
            onPreviewAd={(asset) => {
              selectAsset(asset.id);
              setViewing({ mode: "single" });
            }}
            onSelectResult={(asset) => setAssistant({ open: true, asset })}
            projectId={activeProjectId}
            selectedAsset={assistant.asset}
          />
        </aside>
      ) : null}
    </div>
  );
}

/**
 * Keep the gallery still while the prompt grows.
 *
 * The feed is a bottom-anchored scroller, so anything that shrank it moved
 * every image on screen: each new line of a brief, or a long template landing
 * in the box. The composer is docked over the feed's bottom edge instead, in a
 * slot as tall as the composer minus whatever the prompt has grown past its
 * resting height. A growing brief then rises over the feed, the way a sheet
 * would, and the feed's height only follows the composer's own rows.
 */
function useSteadyDock(
  promptRef: RefObject<HTMLTextAreaElement | null>,
  floating: boolean,
) {
  const slotRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    const dock = dockRef.current;
    if (!slot || !dock) return;
    if (floating) {
      slot.style.height = "";
      return;
    }
    const sync = () => {
      const prompt = promptRef.current;
      const growth = prompt
        ? prompt.offsetHeight -
          Number.parseFloat(getComputedStyle(prompt).minHeight)
        : 0;
      slot.style.height = `${dock.offsetHeight - (growth > 0 ? growth : 0)}px`;
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [promptRef, floating]);
  return { slotRef, dockRef };
}

/**
 * A failed generation as one quiet line, not an alert.
 *
 * A sentence chosen by stable code (never the provider's transport text), the
 * model that failed, that nothing was charged, and one retry. The provider's
 * own words stay one click away for whoever has to report it.
 *
 * The line itself is the disclosure: "{model} failed · not charged" opens to
 * the reason and the provider's words, so the notice is one row beside Try
 * again instead of a title, a paragraph, a toggle and a button row.
 */
export function FailedJob({
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
  const dismiss = (
    <Button
      aria-label={labels.close}
      className="hit-area size-6"
      onClick={onDismiss}
      size="icon"
      variant="ghost"
    >
      <X aria-hidden className="size-3.5" />
    </Button>
  );
  if (uncertain) {
    return (
      <div
        className="bg-card-background text-muted-foreground flex items-start gap-3 rounded-xl p-3 text-sm"
        role="status"
      >
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-foreground font-medium">{labels.uncertainTitle}</p>
          <p className="text-pretty">{labels.uncertainBody}</p>
          {job.error ? (
            <details>
              <summary className="hover:text-foreground focus-visible:ring-ring w-fit cursor-pointer rounded text-xs outline-none select-none focus-visible:ring-2">
                {labels.failedDetails}
              </summary>
              <p className="mt-1 font-mono text-xs break-words">{job.error}</p>
            </details>
          ) : null}
          <div className="flex gap-2 pt-1">
            <Button onClick={onRefresh} size="sm" variant="secondary">
              {labels.checkAgain}
            </Button>
            <Button onClick={onRetry} size="sm" variant="secondary">
              {labels.submitAnyway}
            </Button>
          </div>
        </div>
        {dismiss}
      </div>
    );
  }
  const summary = `${model} ${labels.failedAfterModel} · ${labels.failedNoCharge}`;
  const reason =
    job.failureReason === null
      ? labels.failedBodyUnreported
      : labels.failedBody[job.failureReason];
  const providerError = getDistinctProviderError(reason, job.error);
  return (
    <div
      className="bg-card-background text-muted-foreground grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-3 rounded-xl p-3 text-sm"
      role="status"
    >
      {/* Previously: Try again sits beside the line, and drops under it only when a
          longer translation would squeeze the line into a narrow column.
          The summary now truncates so every control stays on the same row. */}
      <details className="group col-span-full col-start-1 row-start-1 grid min-w-0 grid-cols-subgrid [&::details-content]:col-span-full">
        <summary
          className="text-foreground focus-visible:ring-ring flex min-w-0 cursor-pointer list-none flex-nowrap items-center gap-1 rounded py-1.5 font-medium outline-none select-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden"
          title={summary}
        >
          <AlertTriangle
            aria-hidden
            className="text-muted-foreground me-2 size-4 shrink-0"
          />
          <span className="min-w-0 truncate">{summary}</span>
          <ChevronDown
            aria-hidden
            className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
          />
        </summary>
        <p className="text-pretty">{reason}</p>
        {providerError ? (
          <p className="mt-1 font-mono text-xs break-words">{providerError}</p>
        ) : null}
      </details>
      <Button
        className="col-start-2 row-start-1 shrink-0"
        onClick={onRetry}
        size="sm"
        variant="secondary"
      >
        {labels.tryAgain}
      </Button>
      <div className="col-start-3 row-start-1 mt-1 shrink-0">{dismiss}</div>
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
      className="bg-card-background text-foreground mx-3 mt-2 flex shrink-0 items-start gap-2 rounded-xl p-3 text-sm md:mx-5"
      role="status"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {onDismiss ? (
        <Button
          aria-label={closeLabel}
          className="hit-area size-6"
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
