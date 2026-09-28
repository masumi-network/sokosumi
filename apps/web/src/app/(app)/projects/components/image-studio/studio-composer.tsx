"use client";

import { ChevronDown, Loader2, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  applyPlacement,
  clampToModel,
  estimateBatchUsd,
  formatUsd,
  modelSupportsPlacement,
  placementById,
  placementName,
  priceForImage,
} from "./catalog";
import {
  assetContentUrl,
  type StudioAsset,
  type StudioCatalog,
  type StudioLabels,
  type StudioModel,
  type StudioSettings,
  type StudioTarget,
} from "./types";
import type { QueuedGeneration } from "./use-generation-queue";

/**
 * The most a single press of Generate may buy.
 *
 * Twelve, and the number is picked against three separate limits rather than
 * chosen for feel.
 *
 * It is the whole catalog at the highest copy count: three models times four
 * copies. The point of this composer is one brief across every model at once,
 * so the ceiling has to be at least the cross-product, or the top copy counts
 * are permanently greyed out the moment a second model is selected — which is
 * what a ceiling of four did.
 *
 * It is four times Core's in-flight limit of three per project
 * (`IMAGE_STUDIO_CONCURRENT_JOBS_PER_PROJECT`), which is the safe direction.
 * Twelve at once is not twelve in flight: `useGenerationQueue` sends one at a
 * time, is told `image_studio_project_busy` when Core is full, and waits. So
 * the client never exceeds Core's limit, and it does not duplicate the number
 * either — it learns it by being refused.
 *
 * And it is under a third of Core's hourly allowance of forty per user
 * (`IMAGE_STUDIO_GENERATIONS_PER_USER_PER_HOUR`), so three full batches fit in
 * an hour with room over. A fourth would be refused, and that refusal is the
 * one thing the queue reports rather than retries, so it arrives as a sentence
 * instead of as a stall.
 */
export const MAX_BATCH = 12;

/**
 * Runs per model offered.
 *
 * Four is the top because four times the three-model catalog is the ceiling.
 * The chips disable themselves against the ceiling, so this list can grow with
 * the catalog without becoming a way to ask for more than a batch may hold.
 */
const COPY_CHOICES = [1, 2, 3, 4] as const;

function chipClass(active: boolean, disabled = false): string {
  return cn(
    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
    "focus-visible:ring-ring-halo outline-none focus-visible:ring-[3px]",
    // Selected wins over disabled. A locked row still has to say which value
    // is in force: a placement that sets the frame to 2:3 and then greys the
    // whole row out leaves nothing on screen saying 2:3 was chosen.
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-muted-foreground hover:text-foreground hover:border-primary-tertiary",
    disabled && "cursor-not-allowed opacity-60 hover:border-border",
  );
}

/**
 * One of the composer's three quiet disclosures.
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

const TRIGGER_CLASS =
  "text-muted-foreground hover:text-foreground h-8 max-w-[16rem] min-w-0 gap-1.5 px-2 text-xs font-medium";

/**
 * Where a generation is described and bought.
 *
 * The prompt is the surface; everything that qualifies it is one of three
 * summaries that open on demand — which models, which placement, and the
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
  onGenerate,
  onPromptChange,
  onTargetChange,
  projectId,
  prompt,
  referenceAssets,
  onClearReferences,
  target,
}: {
  busy: boolean;
  catalog: StudioCatalog;
  labels: StudioLabels;
  onGenerate: (requests: QueuedGeneration[]) => void;
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
  projectId: string;
  prompt: string;
  /** Images the person picked in the gallery to generate *from*. */
  referenceAssets: StudioAsset[];
  onClearReferences: () => void;
  target: StudioTarget;
}) {
  // Only for the strings that interpolate a count; see `StudioLabels`.
  const t = useTranslations("App.Studio");
  const [copies, setCopies] = useState(1);
  const { modelIds: selectedModelIds, placementId, settings } = target;

  const selectedModels = useMemo(
    () => catalog.models.filter((model) => selectedModelIds.includes(model.id)),
    [catalog.models, selectedModelIds],
  );

  const placement = placementById(catalog, placementId);

  const setSettings = (update: (current: StudioSettings) => StudioSettings) =>
    onTargetChange((current) => ({
      ...current,
      settings: update(current.settings),
    }));

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

  /** References cannot exceed what the least capable chosen model accepts. */
  const referenceLimit = selectedModels.length
    ? Math.min(...selectedModels.map((model) => model.maxReferences))
    : 0;
  const references = referenceAssets.slice(0, referenceLimit);

  /**
   * The chosen models that can actually serve the active placement.
   *
   * A model's menu entry is already disabled while a placement it cannot frame
   * is chosen, but one selected beforehand stays selected — so this is what
   * both the plan and the submission are built from.
   */
  const eligibleModels = useMemo(
    () =>
      placement
        ? selectedModels.filter((model) =>
            modelSupportsPlacement(model, placement),
          )
        : selectedModels,
    [placement, selectedModels],
  );

  /** Every catalog model that can frame the active placement. */
  const selectableModels = useMemo(
    () =>
      placement
        ? catalog.models.filter((model) =>
            modelSupportsPlacement(model, placement),
          )
        : catalog.models,
    [catalog.models, placement],
  );

  /**
   * Exactly what one press of Generate would buy.
   *
   * Computed once and used three times — the sentence above the button, the
   * estimate inside it, and the requests `submit` enqueues. They have to be the
   * same batch: an estimate about a different purchase from the one the button
   * makes is worse than no estimate at all.
   *
   * The ceiling is applied to the *factors*, not by clipping the finished list.
   * Clipping was the old behaviour, and it made the line above the button a
   * lie the moment the pair ran past the ceiling: selecting a fourth model
   * after choosing four copies promised sixteen images and bought twelve.
   * Bringing the copy count down instead keeps the sentence true, and the copy
   * chips show the clamp, so the loss is visible where the choice is made.
   */
  const plan = useMemo(() => {
    // Only reachable if the catalog ever grows past the ceiling. One run each
    // of as many models as will fit beats several runs of an arbitrary few.
    const models = eligibleModels.slice(0, MAX_BATCH);
    const each = models.length
      ? Math.max(1, Math.min(copies, Math.floor(MAX_BATCH / models.length)))
      : 0;
    const legs: { model: StudioModel; settings: StudioSettings }[] = [];
    // Round-robin across models rather than all of model A then all of model
    // B. The queue drains in this order, so the first pass covers every model
    // asked for — the batch is comparable while it is still arriving, which is
    // the entire reason to run one brief on several models.
    for (let copy = 0; copy < each; copy += 1) {
      for (const model of models) {
        legs.push({ model, settings: clampToModel(model, settings) });
      }
    }
    return { copies: each, legs, models };
  }, [copies, eligibleModels, settings]);

  /**
   * What the batch costs at the providers' published list prices.
   *
   * `null` when any model in it has no published figure for the resolution it
   * would run at, in which case the line says how much work is being bought
   * and stays silent about money.
   */
  const estimateUsd = useMemo(() => estimateBatchUsd(plan.legs), [plan.legs]);

  const totalJobs = plan.legs.length;
  const canGenerate =
    !busy && prompt.trim().length > 0 && eligibleModels.length > 0;

  function toggleModel(model: StudioModel) {
    onTargetChange((current) => {
      const adding = !current.modelIds.includes(model.id);
      const placed = placementById(catalog, current.placementId);
      // A model that cannot frame the active placement must not join the
      // selection. Its menu entry is already disabled, so this is the guard
      // for every other route in — keyboard, a stale render, a future caller.
      if (adding && placed && !modelSupportsPlacement(model, placed)) {
        return current;
      }
      const next = adding
        ? [...current.modelIds, model.id]
        : current.modelIds.filter((id) => id !== model.id);
      // Never leave nothing selected: the composer would have no capabilities
      // to read and every option would empty out.
      if (next.length === 0) return current;
      return {
        ...current,
        modelIds: next,
        // A newly selected model may not offer what is currently chosen.
        settings: clampToModel(model, current.settings),
      };
    });
  }

  /**
   * Choose a placement, and drop any selected model that cannot frame it.
   *
   * Setting the placement alone was not enough. Disabling a model's entry
   * stops it being *added*, but a model selected beforehand stayed selected,
   * and `submit` still built a request for it — where `clampToModel` quietly
   * moved 9:16 to that model's first ratio. The result was a square image
   * carrying a Reels `placementId`: exactly the unsupported combination the
   * catalog exists to prevent, recorded as though it had been honoured.
   *
   * If nothing selected can frame the placement, the first model in the
   * catalog that can is selected instead, so the choice always does something
   * legible rather than silently refusing.
   */
  function choosePlacement(id: string | null) {
    const next = placementById(catalog, id);
    onTargetChange((current) => {
      if (!next) {
        return {
          ...current,
          placementId: null,
          settings: applyPlacement(current.settings, null),
        };
      }
      const kept = current.modelIds.filter((modelId) => {
        const model = catalog.models.find((m) => m.id === modelId);
        return model ? modelSupportsPlacement(model, next) : false;
      });
      const fallback = catalog.models.find((m) =>
        modelSupportsPlacement(m, next),
      );
      const modelIds = kept.length > 0 ? kept : fallback ? [fallback.id] : [];
      // No model in the catalog can frame it: leave the target untouched
      // rather than produce a placement nothing can serve.
      if (modelIds.length === 0) return current;
      return {
        ...current,
        modelIds,
        placementId: next.id,
        settings: applyPlacement(current.settings, next),
      };
    });
  }

  function submit() {
    if (!canGenerate) return;
    // Straight from the plan, so the batch bought is the batch the line above
    // the button described — including its model order and its clamped
    // settings. Nothing is decided a second time here.
    const requests: QueuedGeneration[] = plan.legs.map((leg) => {
      const id = crypto.randomUUID();
      return {
        id,
        prompt: prompt.trim(),
        modelId: leg.model.id,
        modelLabel: leg.model.label,
        settings: leg.settings,
        parentAssetId: references[0]?.id ?? null,
        referenceAssetIds: references.map((asset) => asset.id),
        // One key per request, never shared across the batch: these are
        // deliberately different images, not retries of one.
        idempotencyKey: `ui:${id}`,
      };
    });
    onGenerate(requests);
    onPromptChange("");
  }

  const modelSummary =
    selectedModels.length === 1
      ? selectedModels[0].label
      : t("modelCount", { count: selectedModels.length });

  const optionSummary = [
    settings.aspectRatio,
    settings.resolution,
    settings.outputFormat,
    plan.copies > 1 ? t("copyCount", { count: plan.copies }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      aria-label={labels.composerTitle}
      // `bg-background` on the workspace card, not `bg-card-background`: the
      // card already paints that, and a panel the same colour as the surface
      // under it is either invisible or a seam. As an input well it wants to
      // read slightly recessed anyway.
      className="border-border bg-background focus-within:border-primary-tertiary rounded-lg border transition-colors"
    >
      <div className="px-3 pt-3 sm:px-4 sm:pt-4">
        <Textarea
          aria-label={labels.promptPlaceholder}
          // `dark:bg-transparent` as well as `bg-transparent`: the Textarea
          // primitive paints its own dark-mode fill, and a `dark:` variant is
          // a different utility group, so it survives the class merge. In
          // dark mode the prompt read as an inset panel inside the card
          // rather than as the card.
          className="max-h-48 min-h-20 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 md:text-sm dark:bg-transparent"
          onChange={(event) => onPromptChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={labels.promptPlaceholder}
          value={prompt}
        />

        {references.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
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
                  src={assetContentUrl(projectId, asset.id)}
                />
                v{asset.version}
              </span>
            ))}
            <Button
              className="size-6"
              onClick={onClearReferences}
              size="icon"
              variant="ghost"
            >
              <X aria-hidden className="size-3.5" />
              <span className="sr-only">{labels.clearSelection}</span>
            </Button>
          </div>
        ) : null}
      </div>

      {/* One row, three summaries and the one action. No dividers: the card is
          a single object, and a rule between the prompt and the thing that
          qualifies it made two. */}
      <div className="flex flex-wrap items-center gap-1.5 p-2 sm:px-3 sm:pb-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className={TRIGGER_CLASS} size="sm" variant="ghost">
              <TriggerLabel label={labels.model}>{modelSummary}</TriggerLabel>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80">
            <div className="flex items-center justify-between gap-2 pr-1">
              <DropdownMenuLabel>{labels.model}</DropdownMenuLabel>
              {/* One brief on every model is the thing this composer is for,
                  so it is one click rather than one click per model. Only the
                  models that can frame the active placement are taken, which
                  is the same rule that greys the entries out below. */}
              <Button
                className="h-7 px-2 text-xs"
                disabled={selectableModels.every((model) =>
                  selectedModelIds.includes(model.id),
                )}
                onClick={() =>
                  onTargetChange((current) => ({
                    ...current,
                    modelIds: selectableModels.map((model) => model.id),
                  }))
                }
                size="sm"
                variant="ghost"
              >
                {labels.selectAllModels}
              </Button>
            </div>
            {catalog.models.map((model) => {
              const blocked = Boolean(
                placement && !modelSupportsPlacement(model, placement),
              );
              return (
                <DropdownMenuCheckboxItem
                  checked={selectedModelIds.includes(model.id)}
                  className="items-start"
                  disabled={blocked}
                  key={model.id}
                  // Choosing several models is the reason this is a menu and
                  // not a select, so it must survive its own click.
                  onSelect={(event) => {
                    event.preventDefault();
                    toggleModel(model);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {model.label}
                    </span>
                    <span className="text-muted-foreground block text-xs text-pretty">
                      {blocked
                        ? labels.modelUnsupportedForPlacement
                        : model.description}
                    </span>
                  </span>
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className={TRIGGER_CLASS} size="sm" variant="ghost">
              <TriggerLabel label={labels.placement}>
                {placement ? placementName(placement) : labels.placementNone}
              </TriggerLabel>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-88 max-w-[calc(100vw-2rem)]"
          >
            <DropdownMenuLabel>{labels.placement}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              onValueChange={(value) =>
                choosePlacement(value === "" ? null : value)
              }
              value={placementId ?? ""}
            >
              <DropdownMenuRadioItem className="items-start" value="">
                {labels.placementNone}
              </DropdownMenuRadioItem>
              {catalog.placements.map((option) => (
                <DropdownMenuRadioItem
                  className="items-start"
                  key={option.id}
                  value={option.id}
                >
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-baseline gap-2">
                      {/* The name is what is being chosen, so it wraps.
                          Truncating it turned "Instagram · Reels image
                          concept" into "Instagram · Reels image c…", which
                          loses exactly the part that tells two placements
                          apart. */}
                      <span className="min-w-0 flex-1 font-medium text-pretty">
                        {placementName(option)}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {option.aspectRatio} · {option.width}×{option.height}
                      </span>
                    </span>
                    {/* Core's own sourced note, on the option it belongs to
                        rather than as a paragraph under the whole row. */}
                    <span className="text-muted-foreground block text-xs text-pretty">
                      {option.notes}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            {/* The standing caveat, said once, where the pixel numbers are —
                instead of permanently under the composer. */}
            <p className="text-muted-foreground px-2 py-1.5 text-xs leading-relaxed text-pretty">
              {labels.placementNotOutput}
            </p>
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover>
          <PopoverTrigger asChild>
            <Button className={TRIGGER_CLASS} size="sm" variant="ghost">
              <TriggerLabel label={labels.moreOptions}>
                {optionSummary}
              </TriggerLabel>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 space-y-3">
            <Row label={labels.aspectRatio}>
              {shared.aspectRatios.map((ratio) => (
                <button
                  aria-pressed={settings.aspectRatio === ratio}
                  className={chipClass(
                    settings.aspectRatio === ratio,
                    placement !== null,
                  )}
                  // Placement owns the frame while one is chosen; changing it
                  // here would leave the summary and the request disagreeing.
                  disabled={placement !== null}
                  key={ratio}
                  onClick={() =>
                    setSettings((current) => ({
                      ...current,
                      aspectRatio: ratio as StudioSettings["aspectRatio"],
                    }))
                  }
                  type="button"
                >
                  {ratio}
                </button>
              ))}
            </Row>
            {placement ? (
              <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                {labels.frameSetByPlacement}
              </p>
            ) : null}

            <Row label={labels.resolution}>
              {shared.resolutions.map((resolution) => (
                <button
                  aria-pressed={settings.resolution === resolution}
                  className={chipClass(settings.resolution === resolution)}
                  key={resolution}
                  onClick={() =>
                    setSettings((current) => ({
                      ...current,
                      resolution: resolution as StudioSettings["resolution"],
                    }))
                  }
                  type="button"
                >
                  {resolution}
                </button>
              ))}
            </Row>

            <Row label={labels.outputFormat}>
              {shared.outputFormats.map((format) => (
                <button
                  aria-pressed={settings.outputFormat === format}
                  className={chipClass(settings.outputFormat === format)}
                  key={format}
                  onClick={() =>
                    setSettings((current) => ({
                      ...current,
                      outputFormat: format as StudioSettings["outputFormat"],
                    }))
                  }
                  type="button"
                >
                  {format}
                </button>
              ))}
            </Row>

            <Row label={labels.copies}>
              {COPY_CHOICES.map((count) => {
                // Against the models that will actually run, and against the
                // plan rather than the raw choice: this is where the ceiling
                // becomes visible, so `plan.copies` is what reads as pressed.
                const overCeiling =
                  eligibleModels.length * count > MAX_BATCH && count > 1;
                return (
                  <button
                    aria-pressed={plan.copies === count}
                    className={chipClass(plan.copies === count, overCeiling)}
                    disabled={overCeiling}
                    key={count}
                    onClick={() => setCopies(count)}
                    type="button"
                  >
                    {count}
                  </button>
                );
              })}
            </Row>
            <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
              {t("batchCeiling", { count: MAX_BATCH })}
            </p>
          </PopoverContent>
        </Popover>

        <span className="grow" />

        {/* What the press will buy, said before the press, in fal Sandbox's
            shape: how many runs, across how many models, and what that is
            worth. A button rather than a caption because the money in it is an
            estimate, and an estimate nobody can interrogate is the wrong way
            to talk about a charge — so it opens and shows its working. */}
        {totalJobs > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                className="text-muted-foreground hover:text-foreground h-8 min-w-0 px-2 text-xs font-medium"
                size="sm"
                variant="ghost"
              >
                <span className="min-w-0 truncate tabular-nums">
                  {estimateUsd === null
                    ? t("runPlan", {
                        copies: plan.copies,
                        models: plan.models.length,
                      })
                    : t("runPlanEstimated", {
                        copies: plan.copies,
                        models: plan.models.length,
                        cost: formatUsd(estimateUsd),
                      })}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-88 max-w-[calc(100vw-2rem)] space-y-3"
            >
              <div>
                <p className="text-sm font-medium">{labels.estimateTitle}</p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed text-pretty">
                  {labels.estimateNotCharge}
                </p>
              </div>

              {estimateUsd === null ? (
                <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                  {labels.estimateUnpriced}
                </p>
              ) : null}

              <ul className="space-y-2">
                {plan.models.map((model) => {
                  const resolution = clampToModel(model, settings).resolution;
                  const price = priceForImage(model, resolution);
                  return (
                    <li key={model.id}>
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="min-w-0 flex-1 text-xs font-medium text-pretty">
                          {model.label}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          {price === null
                            ? labels.estimateNoPrice
                            : t("estimateEach", {
                                cost: formatUsd(price),
                                count: plan.copies,
                              })}
                        </span>
                      </div>
                      {/* The provider's own wording for how the figure is
                          arrived at, rather than our paraphrase of it. */}
                      <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed text-pretty">
                        {model.price.basis}
                      </p>
                      <a
                        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring-halo mt-0.5 inline-block rounded text-xs underline underline-offset-2 outline-none focus-visible:ring-[3px]"
                        href={model.price.sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {t("estimateCheckedOn", {
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

        <Button
          disabled={!canGenerate}
          onClick={submit}
          size="sm"
          variant="primary"
        >
          {busy ? (
            <Loader2 aria-hidden className="animate-spin" />
          ) : (
            <Sparkles aria-hidden />
          )}
          {totalJobs > 1
            ? t("generateMany", { count: totalJobs })
            : labels.generateOne}
        </Button>
      </div>
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
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-muted-foreground w-20 shrink-0 text-xs font-medium">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {children}
      </div>
    </div>
  );
}
