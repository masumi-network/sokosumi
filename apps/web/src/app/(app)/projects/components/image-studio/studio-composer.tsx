"use client";

import type {
  StudioProductIdentity,
  StudioProductPhoto,
} from "@sokosumi/core-client";
import {
  MAX_STUDIO_BATCH_IMAGES as MAX_BATCH,
  productBrief,
  studioAdCopyPrompts,
  studioAdVariationIndex,
} from "@sokosumi/utils";
import { ChevronDown, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, useTransition } from "react";
import {
  ROOM_COMPOSER_TEXTAREA_CLASSNAME,
  RoomMessageComposer,
} from "@/components/chat/room-message-composer";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  clampToModel,
  creditsForBatch,
  creditsForImage,
  defaultModel,
  priceUnitLabelKey,
} from "./catalog";
import type { StudioBatchProduct } from "./studio-batch";
import {
  STUDIO_COMPOSER_GUTTER_CLASS,
  STUDIO_PILL_CLASS,
} from "./studio-classes";
import {
  STUDIO_CREATIVE_DIRECTIONS,
  type StudioCreativeDirection,
} from "./studio-creative-directions";
import { readStudioHeadlineKit } from "./studio-headline-kit";
import { AD_PLACEMENTS, type PlacementRatio } from "./studio-placements";
import { StudioProductPhotoControl } from "./studio-product-photo";
import { StudioTemplateMenu } from "./studio-template-picker";
import type { StudioTemplate } from "./studio-templates";
import {
  assetContentUrl,
  MAX_STUDIO_REFERENCES,
  type StudioAsset,
  type StudioCatalog,
  type StudioLabels,
  type StudioSettings,
  type StudioTarget,
} from "./types";
import type { GenerationRequest } from "./use-generation-queue";

const NO_PLACEMENTS: NonNullable<StudioTarget["placementRatios"]> = [];

const COPY_CHOICES = [1, 2, 3, 4] as const;
const MAX_PROMPT_LENGTH = 4_000;
const NO_PRODUCTS: readonly StudioBatchProduct[] = [];
const NO_HEADLINES: readonly string[] = [];

function chipClass(active: boolean, disabled = false): string {
  return cn(
    STUDIO_PILL_CLASS,
    "border",
    // Selected wins over disabled: a row that is locked by the batch ceiling
    // still has to say which value is in force.
    active
      ? "border-foreground bg-primary text-primary-foreground"
      : "border-border text-muted-foreground hover:text-foreground",
    disabled && "cursor-not-allowed opacity-60",
  );
}

/**
 * The composer's disclosure triggers.
 *
 * `h-8` and `text-sm` are what `size="sm"` on this app's Button already means,
 * so a summary is the same height and the same type size as any other small
 * control in the product; the override is only the muted colour and the width
 * cap. They used to be `text-xs`, which made the row that describes the
 * purchase a step smaller than every other control on the page for no reason
 * anyone could name. Emphasis is still carried where it belongs — these are
 * `ghost` and Generate is `primary`.
 */
/** Share of the prompt limit at which the character count shows. */
const COUNT_VISIBLE_FROM = 0.9;

const TRIGGER_CLASS =
  "text-muted-foreground hover:text-foreground h-8 max-w-[min(16rem,100%)] min-w-0 gap-1.5 px-2 text-sm font-medium";

/**
 * Where a generation is described and bought.
 *
 * The composer shows the prompt, the settings the automatic route supports,
 * and the price of the requested images before Generate is pressed.
 *
 * Every option offered — every ratio, every resolution, every format — is
 * read from the model's entry in Core's verified catalog, so the composer
 * cannot offer a combination the provider will refuse.
 */
export function StudioComposer({
  busy,
  catalog,
  labels,
  onApplyTemplate,
  onGenerate,
  onPromptChange,
  onTargetChange,
  prompt,
  promptRef,
  referenceAssets,
  product,
  productPhoto,
  generationProjectId,
  batchProducts = NO_PRODUCTS,
  onClearProductBatch,
  uploadingPhoto = false,
  onProductPhotoChange,
  onPhotoUploadChange,
  onClearReferences,
  onCopiesChange,
  parentAssetId,
  target,
  showTemplates = true,
  onUndoTemplate,
  modeSwitch,
}: {
  /** The Image / Video switch, when the catalog has video models. */
  modeSwitch?: React.ReactNode;
  busy: boolean;
  showTemplates?: boolean;
  /**
   * Present while a template's brief can still be swapped back for the one it
   * replaced. It sits on the toolbar, so offering it never moves the gallery.
   */
  onUndoTemplate?: () => void;
  catalog: StudioCatalog;
  labels: StudioLabels;
  onApplyTemplate: (template: StudioTemplate) => void;
  onGenerate: (requests: GenerationRequest[]) => void;
  /**
   * The prompt lives above this component.
   *
   * The empty gallery offers example briefs to start from, and a suggestion
   * that cannot reach the box it is a suggestion for is decoration. Holding
   * the draft in the studio is also what lets it survive the composer being
   * re-rendered by a generation finishing elsewhere on the page.
   */
  onPromptChange: (value: string) => void;
  /**
   * The page owns the target so templates and recovery can restore settings.
   *
   * An updater rather than a value: two options changed in the same tick are
   * batched, and computing the second from the render's stale `target` threw
   * the first one away. Each update must see the preceding settings change.
   */
  onTargetChange: (update: (current: StudioTarget) => StudioTarget) => void;
  prompt: string;
  /**
   * The prompt box itself, so the studio can put the caret in it.
   *
   * Pressing a template writes the composer's text from outside the composer,
   * and a brief that lands in a box nobody is typing in reads as a submission
   * rather than as a draft to edit.
   */
  promptRef?: React.Ref<HTMLTextAreaElement>;
  /** Images the person picked in the gallery to generate *from*. */
  referenceAssets: StudioAsset[];
  product?: StudioProductIdentity;
  productPhoto?: StudioProductPhoto | null;
  generationProjectId?: string | null;
  batchProducts?: readonly StudioBatchProduct[];
  onClearProductBatch?: () => void;
  onProductPhotoChange?: (photo: StudioProductPhoto | null) => void;
  uploadingPhoto?: boolean;
  onPhotoUploadChange?: (uploading: boolean) => void;
  onClearReferences: () => void;
  onCopiesChange?: () => void;
  /** Recovery keeps the saved parent independent of reference order. */
  parentAssetId?: string | null;
  target: StudioTarget;
}) {
  // Only for the strings that interpolate a count; see `StudioLabels`.
  const t = useTranslations("App.Studio");
  const [copies, setCopies] = useState(1);
  const [loadingHeadlines, startLoadingHeadlines] = useTransition();
  const [headlineStatus, setHeadlineStatus] = useState<{
    projectId: string;
    message: string;
  } | null>(null);
  const headlineOptions =
    target.exportHeadlines?.projectId === generationProjectId
      ? (target.exportHeadlines?.lines ?? NO_HEADLINES)
      : NO_HEADLINES;
  const usesApprovedHeadlines = headlineOptions.length > 0;
  const ideogramModel = catalog.models.find(
    (model) => model.id === "ideogram-v3",
  );
  const automaticModel = defaultModel(catalog);
  const promptHelpId = useId();
  const hasProductBatch = batchProducts.length > 0;
  const productCopies = batchProducts.reduce(
    (sum, entry) => sum + entry.copies,
    0,
  );
  const creativeDirection = target.creativeDirection;
  const guidance = STUDIO_CREATIVE_DIRECTIONS.find(
    ({ id }) => id === creativeDirection,
  )?.guidance;
  const brief = prompt.trim();
  const directionSuffix = guidance ? `\n\nCreative direction: ${guidance}` : "";
  const directedBrief = brief ? brief + directionSuffix : "";
  const batchPrompts = useMemo(
    () =>
      batchProducts.map(
        ({ product }) =>
          [brief, productBrief(product)].filter(Boolean).join("\n\n") +
          directionSuffix,
      ),
    [batchProducts, brief, directionSuffix],
  );
  const promptLength = Math.max(
    directedBrief.length,
    ...batchPrompts.map((value) => value.length),
  );
  const promptTooLong = promptLength > MAX_PROMPT_LENGTH;

  function toggleApprovedHeadlines() {
    if (!generationProjectId || loadingHeadlines) return;
    setHeadlineStatus(null);
    if (usesApprovedHeadlines) {
      onTargetChange((current) => ({ ...current, exportHeadlines: undefined }));
      return;
    }
    startLoadingHeadlines(async () => {
      try {
        const { approvedLines: lines } =
          await readStudioHeadlineKit(generationProjectId);
        if (!lines.length) {
          setHeadlineStatus({
            projectId: generationProjectId,
            message: t("batchHeadlinesEmpty"),
          });
          return;
        }
        onTargetChange((current) => ({
          ...current,
          exportHeadlines: { projectId: generationProjectId, lines },
        }));
      } catch {
        setHeadlineStatus({
          projectId: generationProjectId,
          message: t("headlineLoadFailed"),
        });
      }
    });
  }

  /**
   * fal's pricing unit, singular and translated where we have a word for it.
   *
   * Falls back to fal's own plural for a unit the catalog is not supposed to
   * carry: a wrong-sounding real unit beats a confidently invented singular.
   */
  function priceUnitLabel(unit: string): string {
    const key = priceUnitLabelKey(unit);
    return key ? t(`PriceUnits.${key}`) : unit;
  }
  const { settings, placementRatios = NO_PLACEMENTS } = target;
  const frameCount = Math.max(1, placementRatios.length);
  const hasPhotoReference = hasProductBatch
    ? batchProducts.some(({ photo }) => photo !== null)
    : productPhoto != null;
  const wantsCutout = target.useProductCutout === true;
  const canUseCutout =
    !referenceAssets.length &&
    !parentAssetId &&
    (hasProductBatch
      ? batchProducts.every(({ photo }) => photo !== null)
      : Boolean(productPhoto));
  const useCutout = wantsCutout && canUseCutout;
  const referenceCount =
    referenceAssets.length + (hasPhotoReference && !useCutout ? 1 : 0);
  const tooManyReferences = referenceCount > MAX_STUDIO_REFERENCES;
  const letterExistingBackdrop =
    usesApprovedHeadlines &&
    Boolean(ideogramModel?.editEndpoint) &&
    !hasPhotoReference &&
    !wantsCutout &&
    referenceAssets.length === 1 &&
    referenceAssets[0].id === target.letteringBackdropId;
  // Headlined ads always letter with Ideogram when the catalog can; the
  // exact-font overlay is only a fallback (failed lettering, or no edit path).
  const twoStepLettering =
    !letterExistingBackdrop &&
    usesApprovedHeadlines &&
    automaticModel?.id === "gemini-pro" &&
    Boolean(ideogramModel?.editEndpoint);
  const lettering =
    twoStepLettering || letterExistingBackdrop ? "ideogram" : "overlay";
  const generationModel = letterExistingBackdrop
    ? ideogramModel
    : automaticModel;
  const model =
    generationModel &&
    (referenceCount === 0 ||
      (generationModel.editEndpoint &&
        generationModel.maxReferences >= referenceCount))
      ? generationModel
      : null;

  const setSettings = (update: (current: StudioSettings) => StudioSettings) =>
    onTargetChange((current) => ({
      ...current,
      settings: update(current.settings),
    }));

  function setCreativeDirection(direction?: StudioCreativeDirection) {
    onTargetChange((current) => ({ ...current, creativeDirection: direction }));
  }

  const shared = {
    aspectRatios:
      model?.aspectRatios.filter(
        (ratio) =>
          !twoStepLettering || ideogramModel?.aspectRatios.includes(ratio),
      ) ?? [],
    resolutions:
      model?.resolutions.filter(
        (resolution) =>
          !twoStepLettering || ideogramModel?.resolutions.includes(resolution),
      ) ?? [],
    outputFormats: model?.outputFormats ?? [],
  };

  const unsupportedPlacements =
    model !== null &&
    placementRatios.some((ratio) => !shared.aspectRatios.includes(ratio));

  function togglePlacement(ratio: PlacementRatio) {
    onTargetChange((current) => {
      const ratios = current.placementRatios ?? [];
      return {
        ...current,
        placementRatios: ratios.includes(ratio)
          ? ratios.filter((value) => value !== ratio)
          : [...ratios, ratio],
      };
    });
  }

  const references = referenceAssets;

  const overBatchLimit = frameCount * productCopies > MAX_BATCH;

  // The summary, price and submitted requests all read this same plan.
  const plan = useMemo(() => {
    const frames = placementRatios.length
      ? placementRatios
      : [settings.aspectRatio];
    const configured =
      !model || unsupportedPlacements || tooManyReferences
        ? []
        : frames.map((aspectRatio) => {
            const scene = clampToModel(model, { ...settings, aspectRatio });
            const final =
              twoStepLettering && ideogramModel
                ? clampToModel(ideogramModel, scene)
                : scene;
            return {
              model,
              settings: {
                ...scene,
                aspectRatio: final.aspectRatio,
                resolution: final.resolution,
              },
            };
          });
    const each = configured.length
      ? Math.min(copies, Math.floor(MAX_BATCH / configured.length))
      : 0;
    const entries = hasProductBatch
      ? batchProducts.map(
          ({ copies, photo, product: { id, name } }, index) => ({
            copies,
            photo,
            product: { id, name },
            prompt: batchPrompts[index],
          }),
        )
      : [
          {
            copies: each,
            photo: productPhoto ?? null,
            product,
            prompt: directedBrief,
          },
        ];
    let copyIndex = 0;
    const legs = overBatchLimit
      ? []
      : entries.flatMap((entry) =>
          studioAdCopyPrompts(
            entry.prompt,
            entry.copies,
            MAX_PROMPT_LENGTH,
          ).flatMap((copyPrompt) => {
            const exportHeadline = headlineOptions.length
              ? headlineOptions[copyIndex++ % headlineOptions.length]
              : undefined;
            return configured.map((leg) => ({
              ...leg,
              prompt: copyPrompt,
              photo: entry.photo,
              product: entry.product,
              exportHeadline,
              varied: copyPrompt !== entry.prompt,
            }));
          }),
        );
    const charges = configured.flatMap((leg) =>
      twoStepLettering && ideogramModel
        ? [
            leg,
            {
              model: ideogramModel,
              settings: clampToModel(ideogramModel, leg.settings),
            },
          ]
        : [leg],
    );
    const chargedLegs = legs.flatMap((leg) =>
      twoStepLettering && ideogramModel
        ? [
            leg,
            {
              model: ideogramModel,
              settings: clampToModel(ideogramModel, leg.settings),
            },
          ]
        : [leg],
    );
    return {
      copies: hasProductBatch ? productCopies : each,
      legs,
      configured,
      charges,
      chargedLegs,
    };
  }, [
    batchProducts,
    batchPrompts,
    copies,
    directedBrief,
    hasProductBatch,
    headlineOptions,
    ideogramModel,
    overBatchLimit,
    placementRatios,
    product,
    productCopies,
    productPhoto,
    model,
    settings,
    tooManyReferences,
    unsupportedPlacements,
    twoStepLettering,
  ]);

  /**
   * What this batch will be debited, in credits.
   *
   * The same function Core charges with, over the same catalog row — see
   * `creditsForImage`. `null` when any leg cannot be priced, in which case the
   * line says how much work is being bought and stays silent about credits
   * rather than printing a total that is missing a leg.
   */
  const batchCredits = useMemo(
    () => creditsForBatch(plan.chargedLegs),
    [plan.chargedLegs],
  );
  const sceneCredits = useMemo(() => creditsForBatch(plan.legs), [plan.legs]);

  const totalJobs = plan.legs.length;
  const plannedHeadlines = [
    ...new Set(
      plan.legs.flatMap(({ exportHeadline }) =>
        exportHeadline ? [exportHeadline] : [],
      ),
    ),
  ];
  const canGenerate =
    !busy &&
    !loadingHeadlines &&
    !uploadingPhoto &&
    (!wantsCutout || canUseCutout) &&
    promptLength > 0 &&
    !promptTooLong &&
    totalJobs > 0;

  function submit() {
    if (!canGenerate) return;
    // Straight from the plan, so the batch bought is the batch the line above
    // the button described — including its placements and its clamped
    // settings. Nothing is decided a second time here.
    const requests: GenerationRequest[] = plan.legs.map((leg) => {
      const id = crypto.randomUUID();
      return {
        id,
        prompt: leg.prompt,
        templateId: target.templateId,
        creativeDirection:
          creativeDirection ??
          STUDIO_CREATIVE_DIRECTIONS.find(({ guidance }) =>
            leg.prompt.includes(`\n\nCreative direction: ${guidance}`),
          )?.id,
        variationIndex: studioAdVariationIndex(leg.prompt),
        modelId: leg.model.id,
        modelLabel: leg.model.label,
        settings: leg.settings,
        parentAssetId:
          parentAssetId === undefined
            ? (references[0]?.id ?? null)
            : parentAssetId,
        referenceAssetIds: references.map((asset) => asset.id),
        ...(leg.photo ? { referenceFileIds: [leg.photo.id] } : {}),
        ...(leg.product ? { product: leg.product } : {}),
        ...(leg.exportHeadline
          ? { exportHeadline: leg.exportHeadline, lettering }
          : {}),
        ...(letterExistingBackdrop ? { letterExistingBackdrop: true } : {}),
        ...(useCutout ? { useProductCutout: true } : {}),
        // One key per request, never shared across the batch: these are
        // deliberately different images, not retries of one.
        idempotencyKey: `ui:${id}`,
      };
    });
    // The studio clears the prompt once the batch has somewhere to go: with no
    // project picked yet, the brief stays put while the person chooses one.
    onGenerate(requests);
  }

  const firstSettings = plan.configured[0]?.settings;
  const settingsSummary = firstSettings
    ? [
        firstSettings.aspectRatio,
        firstSettings.resolution,
        firstSettings.outputFormat ?? t("modelChoosesFormat"),
      ]
        .filter(Boolean)
        .join(" · ")
    : labels.moreOptions;
  const optionSummary = [
    creativeDirection ? t(`CreativeDirections.${creativeDirection}`) : null,
    frameCount > 1 || unsupportedPlacements
      ? t("placementCount", { count: frameCount })
      : settingsSummary,
    !hasProductBatch && plan.copies > 1
      ? t("copyCount", { count: plan.copies })
      : null,
    usesApprovedHeadlines ? t("approvedHeadlinesSummary") : null,
    usesApprovedHeadlines
      ? t(lettering === "ideogram" ? "letteringIdeogram" : "letteringOverlay")
      : null,
    useCutout ? t("productCutoutSummary") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      aria-label={labels.composerTitle}
      className="min-w-0 shrink-0 space-y-2"
    >
      {/* The chat room's own composer card, minus the formatting toolbar: same
          border, radius, padding and text size, so the two read as one. */}
      <RoomMessageComposer
        attachments={[]}
        belowEditor={
          <>
            {/* Like the DM composer, the card is only the prompt and its
                controls: the shortcut is read to screen readers, and the
                count and the template undo sit on the toolbar, so typing
                never adds a row. */}
            <span className="sr-only" id={promptHelpId}>
              {t("promptShortcut")}
            </span>
            {onUndoTemplate ? (
              <span className="sr-only" role="status">
                {t("templateReplacedBrief")}
              </span>
            ) : null}
            {promptTooLong ? (
              <p
                className="text-destructive px-4 pb-2 text-xs"
                id={`${promptHelpId}-error`}
                role="alert"
              >
                {t("promptTooLong", { limit: MAX_PROMPT_LENGTH })}
              </p>
            ) : null}
            {unsupportedPlacements ? (
              <p className="text-destructive px-4 pb-2 text-xs" role="alert">
                {t("unsupportedPlacements")}
              </p>
            ) : null}
            {overBatchLimit ? (
              <p className="text-destructive px-4 pb-2 text-xs" role="alert">
                {t("productBatchLimit", { count: MAX_BATCH })}
              </p>
            ) : null}
            {tooManyReferences ? (
              <p className="text-destructive px-4 pb-2 text-xs" role="alert">
                {t("tooManyReferences", { count: MAX_STUDIO_REFERENCES })}
              </p>
            ) : null}
            {wantsCutout && !canUseCutout ? (
              <p
                className="text-muted-foreground px-4 pb-2 text-xs"
                role="status"
              >
                {t("productCutoutNeedsPhoto")}
              </p>
            ) : null}
            {!useCutout && hasPhotoReference && !tooManyReferences && !model ? (
              <p
                className="text-muted-foreground px-4 pb-2 text-xs"
                role="status"
              >
                {t("unsupportedReferences")}
              </p>
            ) : null}
            {hasProductBatch ? (
              <div className="flex items-center gap-2 px-4 pt-1 pb-2">
                <span className="text-muted-foreground shrink-0 text-xs font-medium">
                  {t("batchProductCount", { count: batchProducts.length })}
                </span>
                <div className="app-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto">
                  {batchProducts.map(({ product, copies }) => (
                    <span
                      key={product.id}
                      className="border-border flex max-w-48 shrink-0 gap-1 rounded-md border px-2 py-0.5 text-xs"
                      title={product.name}
                    >
                      <span className="truncate">{product.name}</span>
                      <span className="shrink-0">· {copies}×</span>
                    </span>
                  ))}
                </div>
                {onClearProductBatch ? (
                  <Button
                    onClick={onClearProductBatch}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {t("clearProductBatch")}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {references.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 px-4 pt-1 pb-2">
                <span className="text-muted-foreground text-xs font-medium">
                  {labels.lineage}
                </span>
                {references.map((asset) => (
                  <span
                    className="border-border flex items-center gap-1.5 rounded-md border py-0.5 pr-2 pl-0.5 text-xs"
                    key={asset.id}
                  >
                    <img
                      alt=""
                      className="size-5 rounded-sm object-cover"
                      src={assetContentUrl(asset)}
                    />
                    v{asset.version}
                  </span>
                ))}
                <Button
                  type="button"
                  className="hit-area size-6"
                  onClick={onClearReferences}
                  size="icon"
                  variant="ghost"
                >
                  <X aria-hidden className="size-3.5" />
                  <span className="sr-only">{labels.clearSelection}</span>
                </Button>
              </div>
            ) : null}
          </>
        }
        isSending={busy}
        onRemoveAttachment={() => undefined}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        removeAttachmentLabel={() => ""}
        sendAriaLabel={
          totalJobs > 1
            ? t("generateMany", { count: totalJobs })
            : labels.generateOne
        }
        sendDisabled={!canGenerate}
        toolbarStart={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {modeSwitch}
            {!hasProductBatch && onProductPhotoChange && onPhotoUploadChange ? (
              <StudioProductPhotoControl
                iconOnly
                onPhotoChange={onProductPhotoChange}
                onUploadingChange={onPhotoUploadChange}
                photo={productPhoto ?? null}
                uploading={uploadingPhoto}
              />
            ) : null}
            {showTemplates ? (
              <StudioTemplateMenu
                labels={labels}
                onApplyTemplate={onApplyTemplate}
              />
            ) : null}

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  className={TRIGGER_CLASS}
                  size="sm"
                  variant="ghost"
                >
                  <span className="sr-only">{labels.moreOptions}</span>
                  <span className="min-w-0 truncate">{optionSummary}</span>
                  <ChevronDown
                    aria-hidden
                    className="text-muted-foreground size-3.5"
                  />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="app-scrollbar max-h-[min(32rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto overscroll-contain"
              >
                <Row label={t("creativeDirection")}>
                  <button
                    aria-pressed={creativeDirection === undefined}
                    className={chipClass(creativeDirection === undefined)}
                    onClick={() => setCreativeDirection()}
                    type="button"
                  >
                    {t("CreativeDirections.auto")}
                  </button>
                  {STUDIO_CREATIVE_DIRECTIONS.map(({ id }) => (
                    <button
                      aria-pressed={creativeDirection === id}
                      className={chipClass(creativeDirection === id)}
                      key={id}
                      onClick={() => setCreativeDirection(id)}
                      type="button"
                    >
                      {t(`CreativeDirections.${id}`)}
                    </button>
                  ))}
                </Row>
                {generationProjectId ? (
                  <div className="space-y-1.5">
                    <button
                      aria-pressed={usesApprovedHeadlines}
                      className={chipClass(
                        usesApprovedHeadlines,
                        loadingHeadlines,
                      )}
                      disabled={loadingHeadlines}
                      onClick={toggleApprovedHeadlines}
                      type="button"
                    >
                      {t("useApprovedHeadlines")}
                    </button>
                    <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                      {t("useApprovedHeadlinesHint")}
                    </p>
                    {usesApprovedHeadlines ? (
                      <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                        {t(
                          letterExistingBackdrop
                            ? "letteringEditHint"
                            : twoStepLettering
                              ? "letteringIdeogramHint"
                              : "letteringFallbackHint",
                        )}
                      </p>
                    ) : null}
                    {plannedHeadlines.length ? (
                      <ul className="text-muted-foreground list-disc space-y-0.5 ps-5 text-xs break-words">
                        {plannedHeadlines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    ) : null}
                    {loadingHeadlines ||
                    headlineStatus?.projectId === generationProjectId ? (
                      <p
                        className="text-muted-foreground text-xs"
                        role="status"
                      >
                        {loadingHeadlines
                          ? t("headlineLoading")
                          : headlineStatus?.message}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {canUseCutout || wantsCutout ? (
                  <div className="space-y-1.5">
                    <button
                      aria-pressed={wantsCutout}
                      className={chipClass(wantsCutout)}
                      onClick={() =>
                        onTargetChange((current) => ({
                          ...current,
                          useProductCutout: !current.useProductCutout,
                        }))
                      }
                      type="button"
                    >
                      {t("useProductCutout")}
                    </button>
                    <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                      {t(
                        canUseCutout
                          ? "productCutoutHint"
                          : "productCutoutNeedsPhoto",
                      )}
                    </p>
                  </div>
                ) : null}
                <Row label={t("adPlacements")}>
                  {AD_PLACEMENTS.map(({ ratio, label }) => {
                    const selected = placementRatios.includes(ratio);
                    const unsupported = !shared.aspectRatios.includes(ratio);
                    const exceedsLimit =
                      (placementRatios.length + 1) *
                        Math.max(1, productCopies) >
                      MAX_BATCH;
                    const disabled = !selected && (unsupported || exceedsLimit);
                    const reason = unsupported
                      ? t("unsupportedFrame")
                      : exceedsLimit
                        ? t("placementLimit", { count: MAX_BATCH })
                        : undefined;
                    return (
                      <button
                        aria-describedby={
                          disabled ? `${promptHelpId}-${label}` : undefined
                        }
                        aria-disabled={disabled || undefined}
                        aria-pressed={selected}
                        className={chipClass(selected, disabled)}
                        key={ratio}
                        onClick={() => {
                          if (!disabled) togglePlacement(ratio);
                        }}
                        title={disabled ? reason : undefined}
                        type="button"
                      >
                        {t(`Placements.${label}`)} · {ratio}
                        {disabled ? (
                          <span
                            className="sr-only"
                            id={`${promptHelpId}-${label}`}
                          >
                            {reason}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </Row>

                <Row label={labels.aspectRatio}>
                  {shared.aspectRatios.map((ratio) => (
                    <button
                      aria-pressed={
                        placementRatios.length === 0 &&
                        settings.aspectRatio === ratio
                      }
                      className={chipClass(
                        placementRatios.length === 0 &&
                          settings.aspectRatio === ratio,
                      )}
                      key={ratio}
                      onClick={() =>
                        onTargetChange((current) => ({
                          ...current,
                          placementRatios: undefined,
                          settings: {
                            ...current.settings,
                            aspectRatio: ratio as StudioSettings["aspectRatio"],
                          },
                        }))
                      }
                      type="button"
                    >
                      {ratio}
                    </button>
                  ))}
                </Row>

                <Row label={labels.resolution}>
                  {shared.resolutions.map((resolution) => (
                    <button
                      aria-pressed={settings.resolution === resolution}
                      className={chipClass(settings.resolution === resolution)}
                      key={resolution}
                      onClick={() =>
                        setSettings((current) => ({
                          ...current,
                          resolution:
                            resolution as StudioSettings["resolution"],
                        }))
                      }
                      type="button"
                    >
                      {resolution}
                    </button>
                  ))}
                </Row>

                {/* A provider may determine the output format itself. Its
                price breakdown shows that alongside the actual settings. */}
                {shared.outputFormats.length > 0 ? (
                  <Row label={labels.outputFormat}>
                    {shared.outputFormats.map((format) => (
                      <button
                        aria-pressed={settings.outputFormat === format}
                        className={chipClass(settings.outputFormat === format)}
                        key={format}
                        onClick={() =>
                          setSettings((current) => ({
                            ...current,
                            outputFormat:
                              format as StudioSettings["outputFormat"],
                          }))
                        }
                        type="button"
                      >
                        {format}
                      </button>
                    ))}
                  </Row>
                ) : null}

                {hasProductBatch ? (
                  <p className="text-muted-foreground text-xs">
                    {t("copiesFromProducts")}
                  </p>
                ) : (
                  <Row label={labels.copies}>
                    {COPY_CHOICES.map((count) => {
                      // Each copy needs one image per placement, so a wider
                      // set of placements can bring the copy count down. The
                      // pressed chip shows the count the plan can deliver.
                      const images = frameCount * count;
                      const overCeiling = images > MAX_BATCH && count > 1;
                      /**
                       * Why this one is unavailable, in its own arithmetic.
                       *
                       * The ceiling is unchanged; only the explaining is new. A
                       * dimmed "3" beside a footnote about a limit left a sighted
                       * reader to do the multiplication and a screen-reader user with
                       * "3, dimmed" and nothing at all.
                       */
                      const reason = overCeiling
                        ? t("placementCopiesOverCeiling", {
                            images,
                            limit: MAX_BATCH,
                          })
                        : undefined;
                      return (
                        <button
                          // `aria-disabled`, not `disabled`: a natively disabled
                          // control is not focusable, so the reason could never be
                          // read out — which is the whole point of having one. The
                          // press is blocked below instead.
                          aria-describedby={
                            reason ? `studio-copies-${count}-reason` : undefined
                          }
                          aria-disabled={overCeiling || undefined}
                          aria-pressed={plan.copies === count}
                          className={chipClass(
                            plan.copies === count,
                            overCeiling,
                          )}
                          key={count}
                          onClick={() => {
                            if (overCeiling) return;
                            setCopies(count);
                            onCopiesChange?.();
                          }}
                          title={reason}
                          type="button"
                        >
                          {count}
                          {reason ? (
                            <span
                              className="sr-only"
                              id={`studio-copies-${count}-reason`}
                            >
                              {reason}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </Row>
                )}
                <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                  {t("batchCeiling", { count: MAX_BATCH })}
                </p>
              </PopoverContent>
            </Popover>

            {totalJobs > 0 ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    className="text-muted-foreground hover:text-foreground h-auto min-h-8 max-w-full min-w-0 px-2 py-1 text-sm font-medium whitespace-normal"
                    size="sm"
                    variant="ghost"
                  >
                    <span className="min-w-0 text-start tabular-nums">
                      {twoStepLettering
                        ? batchCredits === null || sceneCredits === null
                          ? t("letteringPlan")
                          : t("letteringPlanCredits", {
                              sceneCredits,
                              letteringCredits: batchCredits - sceneCredits,
                              credits: batchCredits,
                            })
                        : batchCredits === null
                          ? t("placementPlan", { count: totalJobs })
                          : t("placementPlanCredits", {
                              count: totalJobs,
                              credits: batchCredits,
                            })}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="app-scrollbar max-h-[min(32rem,var(--radix-popover-content-available-height))] w-88 max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto overscroll-contain"
                >
                  <div>
                    <p className="text-sm font-medium">{labels.creditsTitle}</p>
                    <p className="text-muted-foreground mt-1 text-xs leading-relaxed text-pretty">
                      {labels.creditsCharged}
                    </p>
                  </div>

                  {batchCredits === null ? (
                    <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                      {labels.creditsUnderivable}
                    </p>
                  ) : null}

                  {!usesApprovedHeadlines &&
                  plan.legs.some(({ varied }) => varied) ? (
                    <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                      {t("variedAdCopies")}
                    </p>
                  ) : null}

                  {plan.legs.some(({ photo }) => photo) ? (
                    <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                      {t(
                        useCutout
                          ? "productCutoutHint"
                          : "productPhotoGuidance",
                      )}
                    </p>
                  ) : null}

                  <ul className="space-y-2">
                    {plan.charges.map(({ model, settings: actual }) => {
                      const credits = creditsForImage(model, actual);
                      return (
                        <li key={`${model.id}:${actual.aspectRatio}`}>
                          <div className="flex min-w-0 items-baseline gap-2">
                            <span className="min-w-0 flex-1 text-xs font-medium text-pretty">
                              {model.label}
                            </span>
                            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                              {credits === null
                                ? labels.creditsNoFigure
                                : t("creditsEach", {
                                    credits,
                                    count: plan.copies,
                                  })}
                            </span>
                          </div>
                          <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                            {labels.dimensions}:{" "}
                            {[
                              actual.aspectRatio,
                              actual.resolution,
                              actual.outputFormat ?? t("modelChoosesFormat"),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {/* Composed here rather than rendered from Core's
                          `price.basis`. That string is built as "fal lists
                          $0.03 per images for this endpoint" — fal's pricing
                          API answers in plurals because it is describing a
                          rate, and a sentence about one image then reads "per
                          images". Web holds the same two figures separately,
                          so it can say it once, correctly, and in the reader's
                          language. */}
                          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed text-pretty">
                            {t("priceBasis", {
                              price: `$${model.price.unitPriceUsd}`,
                              unit: priceUnitLabel(model.price.unit),
                            })}
                          </p>
                          <a
                            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mt-0.5 inline-block rounded text-xs underline underline-offset-2 outline-none focus-visible:ring-2"
                            href={model.price.sourceUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {t("creditsCheckedOn", {
                              date: model.price.verifiedAt,
                            })}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </PopoverContent>
              </Popover>
            ) : null}
            {promptLength >= MAX_PROMPT_LENGTH * COUNT_VISIBLE_FROM ? (
              <span
                className={cn(
                  "text-muted-foreground text-xs tabular-nums",
                  promptTooLong && "text-destructive",
                )}
              >
                {t("promptCharacterCount", {
                  count: promptLength,
                  limit: MAX_PROMPT_LENGTH,
                })}
              </span>
            ) : null}
            {onUndoTemplate ? (
              <Button
                type="button"
                className="text-muted-foreground hover:text-foreground h-8 px-2 text-sm font-medium"
                onClick={onUndoTemplate}
                size="sm"
                variant="ghost"
              >
                <Undo2 aria-hidden />
                <span className="max-sm:sr-only">{t("undoTemplate")}</span>
              </Button>
            ) : null}
          </div>
        }
        className={STUDIO_COMPOSER_GUTTER_CLASS}
        withOuterPadding={false}
        withSafeAreaPadding
      >
        <Textarea
          aria-label={labels.promptPlaceholder}
          aria-describedby={
            promptTooLong
              ? `${promptHelpId} ${promptHelpId}-error`
              : promptHelpId
          }
          aria-invalid={promptTooLong || undefined}
          className={ROOM_COMPOSER_TEXTAREA_CLASSNAME}
          onChange={(event) => onPromptChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !event.shiftKey &&
              !event.altKey &&
              !event.repeat &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={labels.promptPlaceholder}
          ref={promptRef}
          value={prompt}
        />
      </RoomMessageComposer>
    </section>
  );
}

function Row({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {children}
      </div>
    </div>
  );
}
