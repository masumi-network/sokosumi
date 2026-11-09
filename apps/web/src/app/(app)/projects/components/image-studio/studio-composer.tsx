"use client";

import type {
  StudioProductIdentity,
  StudioProductPhoto,
} from "@sokosumi/core-client";
import {
  MAX_STUDIO_BATCH_IMAGES as MAX_BATCH,
  productBrief,
} from "@sokosumi/utils";
import { Check, ChevronDown, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState } from "react";
import {
  ROOM_COMPOSER_TEXTAREA_CLASSNAME,
  RoomMessageComposer,
} from "@/components/chat/room-message-composer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { POPOVER_ROW_CLASS } from "@/components/ui/popover-row-classes";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  clampToModel,
  creditsForBatch,
  creditsForImage,
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
  studioAdCopyPrompts,
} from "./studio-creative-directions";
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
  type StudioModel,
  type StudioSettings,
  type StudioTarget,
} from "./types";
import type { GenerationRequest } from "./use-generation-queue";

const NO_PLACEMENTS: NonNullable<StudioTarget["placementRatios"]> = [];

const COPY_CHOICES = [1, 2, 3, 4] as const;
const MAX_PROMPT_LENGTH = 4_000;
const NO_PRODUCTS: readonly StudioBatchProduct[] = [];

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
 * One of the composer's two quiet disclosures.
 *
 * Each says what is currently chosen and opens to let it be changed. They are
 * deliberately the same shape and the same weight, so the eye lands on the
 * one thing that is a different weight — the Generate button.
 */
function TriggerLabel({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <>
      <span className="sr-only">{label}</span>
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDown aria-hidden className="text-muted-foreground size-3.5" />
    </>
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
  "text-muted-foreground hover:text-foreground h-8 max-w-[16rem] min-w-0 gap-1.5 px-2 text-sm font-medium";

/**
 * Where a generation is described and bought.
 *
 * The prompt is the surface; everything that qualifies it is one of two
 * summaries that open on demand — which models, and the
 * frame/resolution/format the request will carry. They read as a sentence
 * about the work rather than as a form, and the only emphatic control on the
 * page is the one that spends money.
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
   * The target is shared with the assistant, so the page owns it.
   *
   * An updater rather than a value: two options changed in the same tick are
   * batched, and computing the second from the render's stale `target` threw
   * the first one away. Selecting two models quickly is the normal way to use
   * this composer, so that was not a rare case.
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
  const [modelQuery, setModelQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
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
  const {
    modelIds: selectedModelIds,
    settings,
    placementRatios = NO_PLACEMENTS,
  } = target;
  const frameCount = Math.max(1, placementRatios.length);
  const hasPhotoReference = hasProductBatch
    ? batchProducts.some(({ photo }) => photo !== null)
    : productPhoto != null;
  const referenceCount = referenceAssets.length + (hasPhotoReference ? 1 : 0);
  const tooManyReferences = referenceCount > MAX_STUDIO_REFERENCES;
  const modelLimit = Math.floor(
    MAX_BATCH / (frameCount * Math.max(1, productCopies)),
  );

  // A reference is an edit request. Only offer models that can consume every
  // selected image; a generation-only model must never drop the base image.
  const availableModels = useMemo(
    () =>
      catalog.models.filter(
        (model) =>
          referenceCount === 0 ||
          (model.editEndpoint !== null &&
            model.maxReferences >= referenceCount),
      ),
    [catalog.models, referenceCount],
  );
  const selectedModels = useMemo(
    () =>
      availableModels.filter((model) => selectedModelIds.includes(model.id)),
    [availableModels, selectedModelIds],
  );

  const needle = modelQuery.trim().toLowerCase();
  const shownModels = useMemo(
    () =>
      needle === ""
        ? availableModels
        : availableModels.filter((model) =>
            `${model.label} ${model.id}`.toLowerCase().includes(needle),
          ),
    [availableModels, needle],
  );

  /** Select the shown models that fit, keeping the existing selection first. */
  function setShown(on: boolean) {
    const ids = new Set(shownModels.map((model) => model.id));
    onTargetChange((current) => {
      const selectedCount = availableModels.filter((model) =>
        current.modelIds.includes(model.id),
      ).length;
      return {
        ...current,
        modelIds: on
          ? [
              ...current.modelIds,
              ...shownModels
                .map((model) => model.id)
                .filter((id) => !current.modelIds.includes(id))
                .slice(0, Math.max(0, modelLimit - selectedCount)),
            ]
          : current.modelIds.filter((id) => !ids.has(id)),
      };
    });
  }

  const setSettings = (update: (current: StudioSettings) => StudioSettings) =>
    onTargetChange((current) => ({
      ...current,
      settings: update(current.settings),
    }));

  function setCreativeDirection(direction?: StudioCreativeDirection) {
    onTargetChange((current) => ({ ...current, creativeDirection: direction }));
  }

  /**
   * The options every chosen model can honour.
   *
   * An intersection, not a union: a ratio only one of two selected models
   * supports would produce a batch where half the images silently came back
   * framed differently from what was asked.
   */
  const shared = useMemo(() => {
    if (selectedModels.length === 0) {
      return { aspectRatios: [], resolutions: [], outputFormats: [] };
    }
    const intersect = (pick: (model: StudioModel) => string[]) =>
      selectedModels
        .map(pick)
        .reduce((all, next) => all.filter((value) => next.includes(value)));
    return {
      aspectRatios: intersect((model) => model.aspectRatios),
      resolutions: intersect((model) => model.resolutions),
      outputFormats: intersect((model) => model.outputFormats),
    };
  }, [selectedModels]);

  const unsupportedPlacements =
    selectedModels.length > 0 &&
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

  const overSelectionLimit = selectedModels.length > modelLimit;

  // The summary, price and submitted requests all read this same plan.
  const plan = useMemo(() => {
    const frames = placementRatios.length
      ? placementRatios
      : [settings.aspectRatio];
    const configured = (
      unsupportedPlacements || tooManyReferences ? [] : frames
    ).flatMap((aspectRatio) =>
      selectedModels.map((model) => ({
        model,
        settings: clampToModel(model, { ...settings, aspectRatio }),
      })),
    );
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
    const legs = overSelectionLimit
      ? []
      : entries.flatMap((entry) =>
          studioAdCopyPrompts(
            entry.prompt,
            entry.copies,
            MAX_PROMPT_LENGTH,
          ).flatMap((copyPrompt) =>
            configured.map((leg) => ({
              ...leg,
              prompt: copyPrompt,
              photo: entry.photo,
              product: entry.product,
              varied: copyPrompt !== entry.prompt,
            })),
          ),
        );
    return { copies: hasProductBatch ? productCopies : each, legs, configured };
  }, [
    batchProducts,
    batchPrompts,
    copies,
    directedBrief,
    hasProductBatch,
    overSelectionLimit,
    placementRatios,
    product,
    productCopies,
    productPhoto,
    selectedModels,
    settings,
    tooManyReferences,
    unsupportedPlacements,
  ]);

  /**
   * What this batch will be debited, in credits.
   *
   * The same function Core charges with, over the same catalog row — see
   * `creditsForImage`. `null` when any leg cannot be priced, in which case the
   * line says how much work is being bought and stays silent about credits
   * rather than printing a total that is missing a leg.
   */
  const batchCredits = useMemo(() => creditsForBatch(plan.legs), [plan.legs]);

  const totalJobs = plan.legs.length;
  const selectionLimitReached = selectedModels.length >= modelLimit;
  const selectionLimitReason = hasProductBatch
    ? t("productBatchLimit", { count: MAX_BATCH })
    : t("modelSelectionLimit", { count: modelLimit });
  const canGenerate =
    !busy &&
    !uploadingPhoto &&
    promptLength > 0 &&
    !promptTooLong &&
    totalJobs > 0;

  function toggleModel(model: StudioModel) {
    onTargetChange((current) => {
      const adding = !current.modelIds.includes(model.id);
      if (
        adding &&
        availableModels.filter((candidate) =>
          current.modelIds.includes(candidate.id),
        ).length >= modelLimit
      ) {
        return current;
      }
      const next = adding
        ? [...current.modelIds, model.id]
        : current.modelIds.filter((id) => id !== model.id);
      // Emptying the selection is allowed. It used to be refused, on the
      // grounds that the option rows would have no capabilities to read — but
      // that made the last remaining model unclearable, and with five selected
      // on open that is a control that visibly stops working. Generate is
      // disabled and the rows say what to do instead.
      return {
        ...current,
        modelIds: next,
        // Only when adding, which is the only direction that can need it: a
        // newly selected model may not offer what is currently chosen, while
        // removing one can only widen the intersection. Clamping on the way out
        // is a no-op today — every selected model already supports the current
        // frame — so this is not a bug fix, it is refusing to run a rule in the
        // direction where it could only ever be wrong.
        settings: adding
          ? clampToModel(model, current.settings)
          : current.settings,
      };
    });
  }

  function submit() {
    if (!canGenerate) return;
    // Straight from the plan, so the batch bought is the batch the line above
    // the button described — including its model order and its clamped
    // settings. Nothing is decided a second time here.
    const requests: GenerationRequest[] = plan.legs.map((leg) => {
      const id = crypto.randomUUID();
      return {
        id,
        prompt: leg.prompt,
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
        // One key per request, never shared across the batch: these are
        // deliberately different images, not retries of one.
        idempotencyKey: `ui:${id}`,
      };
    });
    // The studio clears the prompt once the batch has somewhere to go: with no
    // project picked yet, the brief stays put while the person chooses one.
    onGenerate(requests);
  }

  const modelSummary =
    selectedModels.length === 1
      ? selectedModels[0].label
      : t("modelCount", { count: selectedModels.length });

  const hasSharedFormat = shared.outputFormats.length > 0;

  const plannedSettings = plan.configured.map(({ settings: actual }) =>
    [
      actual.aspectRatio,
      actual.resolution,
      actual.outputFormat ?? t("modelChoosesFormat"),
    ]
      .filter(Boolean)
      .join(" · "),
  );
  const mixedSettings = new Set(plannedSettings).size > 1;
  const optionSummary = [
    creativeDirection ? t(`CreativeDirections.${creativeDirection}`) : null,
    frameCount > 1 || unsupportedPlacements
      ? t("placementCount", { count: frameCount })
      : mixedSettings
        ? t("mixedSettings")
        : (plannedSettings[0] ?? labels.moreOptions),
    !hasProductBatch && plan.copies > 1
      ? t("copyCount", { count: plan.copies })
      : null,
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
            {overSelectionLimit ? (
              <p className="text-destructive px-4 pb-2 text-xs" role="alert">
                {selectionLimitReason}
              </p>
            ) : null}
            {tooManyReferences ? (
              <p className="text-destructive px-4 pb-2 text-xs" role="alert">
                {t("tooManyReferences", { count: MAX_STUDIO_REFERENCES })}
              </p>
            ) : null}
            {hasPhotoReference &&
            !tooManyReferences &&
            selectedModels.length === 0 ? (
              <p
                className="text-muted-foreground px-4 pb-2 text-xs"
                role="status"
              >
                {t("productPhotoNeedsModel")}
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
        toolbarEnd={
          <>
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
          </>
        }
        toolbarStart={
          <>
            {modeSwitch}
            {!hasProductBatch && onProductPhotoChange && onPhotoUploadChange ? (
              <StudioProductPhotoControl
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
                triggerClassName={TRIGGER_CLASS}
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
                  <TriggerLabel label={labels.model}>
                    {modelSummary}
                  </TriggerLabel>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="app-scrollbar max-h-[min(32rem,var(--radix-popover-content-available-height))] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain p-2"
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  searchRef.current?.focus();
                }}
              >
                <div className="flex items-center justify-between gap-2 pb-2">
                  {/* One brief on every model is the thing this composer is for,
                  so it is one click rather than one click per model. Both
                  act on what the search shows, so "select all" after typing
                  "flux" means every FLUX, not the whole catalog. */}
                  <span className="text-muted-foreground px-1 text-xs font-medium">
                    {labels.model}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      className="h-7 px-2 text-xs"
                      disabled={
                        selectionLimitReached ||
                        shownModels.every((model) =>
                          selectedModelIds.includes(model.id),
                        )
                      }
                      onClick={() => setShown(true)}
                      size="sm"
                      variant="ghost"
                    >
                      {selectedModels.length +
                        shownModels.filter(
                          (model) => !selectedModelIds.includes(model.id),
                        ).length >
                      modelLimit
                        ? t("selectModelsUpToLimit", { count: modelLimit })
                        : labels.selectAllModels}
                    </Button>
                    <Button
                      type="button"
                      className="h-7 px-2 text-xs"
                      disabled={
                        !shownModels.some((model) =>
                          selectedModelIds.includes(model.id),
                        )
                      }
                      onClick={() => setShown(false)}
                      size="sm"
                      variant="ghost"
                    >
                      {labels.unselectAllModels}
                    </Button>
                  </div>
                </div>
                <Input
                  aria-label={labels.searchModels}
                  ref={searchRef}
                  className="mb-2 h-8 text-sm"
                  onChange={(event) => setModelQuery(event.currentTarget.value)}
                  placeholder={labels.searchModels}
                  value={modelQuery}
                />
                <p
                  className="text-muted-foreground mb-2 px-1 text-xs"
                  id="studio-model-selection-limit"
                >
                  {selectionLimitReason}
                </p>
                <div
                  className="app-scrollbar max-h-80 overflow-y-auto overscroll-contain"
                  role="group"
                  aria-label={labels.model}
                >
                  {shownModels.length === 0 ? (
                    <p className="text-muted-foreground px-2 py-3 text-xs">
                      {labels.noModelsMatch}
                    </p>
                  ) : null}
                  {shownModels.map((model) => {
                    const credits = creditsForImage(
                      model,
                      clampToModel(model, {
                        ...settings,
                        aspectRatio: placementRatios[0] ?? settings.aspectRatio,
                      }),
                    );
                    const checked = selectedModelIds.includes(model.id);
                    const unavailable = !checked && selectionLimitReached;
                    return (
                      <button
                        aria-checked={checked}
                        aria-describedby={
                          unavailable
                            ? "studio-model-selection-limit"
                            : undefined
                        }
                        aria-disabled={unavailable || undefined}
                        className={cn(
                          POPOVER_ROW_CLASS,
                          "flex w-full cursor-pointer items-start gap-2 px-2 py-1.5 text-left",
                          unavailable && "cursor-not-allowed opacity-60",
                        )}
                        key={model.id}
                        onClick={() => toggleModel(model)}
                        role="checkbox"
                        type="button"
                      >
                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                          {checked ? (
                            <Check aria-hidden className="size-4" />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                              {model.label}
                            </span>
                            {frameCount === 1 ? (
                              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                                {credits === null
                                  ? labels.creditsNoFigure
                                  : t("creditsCount", { count: credits })}
                              </span>
                            ) : null}
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {model.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  className={TRIGGER_CLASS}
                  size="sm"
                  variant="ghost"
                >
                  <TriggerLabel label={labels.moreOptions}>
                    {optionSummary}
                  </TriggerLabel>
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
                {/* Every row below reads its options from the chosen models, so
                with none chosen they are all empty. Saying so beats three
                labelled rows with nothing in them. */}
                {selectedModels.length === 0 ? (
                  <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                    {labels.noModelSelected}
                  </p>
                ) : null}
                {mixedSettings && frameCount === 1 ? (
                  <ul className="space-y-2 text-xs">
                    {plan.configured.map(({ model }, index) => (
                      <li className="break-words" key={model.id}>
                        <span className="font-medium">{model.label}</span>
                        <p className="text-muted-foreground tabular-nums">
                          {labels.dimensions}: {plannedSettings[index]}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <p className="text-muted-foreground text-xs text-pretty">
                  {t("placementHelp")}
                </p>
                <Row label={t("adPlacements")}>
                  {AD_PLACEMENTS.map(({ ratio, label }) => {
                    const selected = placementRatios.includes(ratio);
                    const unsupported = !shared.aspectRatios.includes(ratio);
                    const exceedsLimit =
                      selectedModels.length *
                        (placementRatios.length + 1) *
                        Math.max(1, productCopies) >
                      MAX_BATCH;
                    const disabled = !selected && (unsupported || exceedsLimit);
                    const reason = unsupported
                      ? t("placementNeedsModels")
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

                {/* Without a shared format there are no common choices to offer.
                Each model's actual format is disclosed with its settings. */}
                {hasSharedFormat ? (
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
                      // Against the models that will actually run, and against the
                      // plan rather than the raw choice: this is where the ceiling
                      // becomes visible, so `plan.copies` is what reads as pressed.
                      const images = selectedModels.length * frameCount * count;
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
                        ? frameCount > 1
                          ? t("placementCopiesOverCeiling", {
                              images,
                              limit: MAX_BATCH,
                            })
                          : t("copiesOverCeiling", {
                              models: selectedModels.length,
                              copies: count,
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
                    className="text-muted-foreground hover:text-foreground h-8 min-w-0 px-2 text-sm font-medium"
                    size="sm"
                    variant="ghost"
                  >
                    <span className="min-w-0 truncate tabular-nums">
                      {hasProductBatch || frameCount > 1
                        ? batchCredits === null
                          ? t("placementPlan", { count: totalJobs })
                          : t("placementPlanCredits", {
                              count: totalJobs,
                              credits: batchCredits,
                            })
                        : batchCredits === null
                          ? t("runPlan", {
                              copies: plan.copies,
                              models: selectedModels.length,
                            })
                          : t("runPlanCredits", {
                              copies: plan.copies,
                              models: selectedModels.length,
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

                  {plan.legs.some(({ varied }) => varied) ? (
                    <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                      {t("variedAdCopies")}
                    </p>
                  ) : null}

                  <ul className="space-y-2">
                    {plan.configured.map(
                      ({ model, settings: actual }, index) => {
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
                              {labels.dimensions}: {plannedSettings[index]}
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
                      },
                    )}
                  </ul>
                </PopoverContent>
              </Popover>
            ) : null}
          </>
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
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      <span className="text-muted-foreground w-20 shrink-0 text-xs font-medium">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {children}
      </div>
    </div>
  );
}
