"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  clampToModel,
  creditsForBatch,
  creditsForImage,
  priceUnitLabelKey,
} from "./catalog";
import { STUDIO_PILL_CLASS } from "./studio-classes";
import { StudioTemplateStrip } from "./studio-template-picker";
import type { StudioTemplate } from "./studio-templates";
import {
  assetContentUrl,
  type StudioAsset,
  type StudioCatalog,
  type StudioLabels,
  type StudioModel,
  type StudioSettings,
  type StudioTarget,
} from "./types";
import type { GenerationRequest } from "./use-generation-queue";

/**
 * The most a single press of Generate may buy.
 *
 * Twelve, and the number is picked against Core's own limits rather than
 * chosen for feel.
 *
 * It used to be justified as "the whole catalog at the highest copy count:
 * three models times four copies". That reading is gone — the catalog is 152
 * models now and the studio opens on the curated five — so the ceiling is no
 * longer a cross-product of anything. What it still is, is comfortably more
 * than one run of the shortlist, which is the batch this composer exists to
 * make. The visible cost is that five models cap out at two copies each; the
 * copy chips disable themselves and `plan` brings the count down, so the line
 * above the button stays true about it.
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
 * Four is reachable only with one, two or three models selected; past that the
 * batch ceiling takes it down and the chips grey themselves out against it. So
 * this list is what may be *asked* for, never what may be bought, and it stays
 * correct however many models the catalog grows to.
 */
const COPY_CHOICES = [1, 2, 3, 4] as const;

function chipClass(active: boolean, disabled = false): string {
  return cn(
    STUDIO_PILL_CLASS,
    "border",
    // Selected wins over disabled: a row that is locked by the batch ceiling
    // still has to say which value is in force.
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-muted-foreground hover:text-foreground hover:border-primary-tertiary",
    disabled && "cursor-not-allowed opacity-60 hover:border-border",
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
  onClearReferences,
  target,
  showTemplates = true,
}: {
  busy: boolean;
  showTemplates?: boolean;
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
  onClearReferences: () => void;
  target: StudioTarget;
}) {
  // Only for the strings that interpolate a count; see `StudioLabels`.
  const t = useTranslations("App.Studio");
  const [copies, setCopies] = useState(1);
  const [modelQuery, setModelQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

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
  const { modelIds: selectedModelIds, settings } = target;

  // A reference is an edit request. Only offer models that can consume every
  // selected image; a generation-only model must never drop the base image.
  const availableModels = useMemo(
    () =>
      catalog.models.filter(
        (model) =>
          referenceAssets.length === 0 ||
          (model.editEndpoint !== null &&
            model.maxReferences >= referenceAssets.length),
      ),
    [catalog.models, referenceAssets.length],
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

  /** Select or unselect exactly the models the search is showing. */
  function setShown(on: boolean) {
    const ids = new Set(shownModels.map((model) => model.id));
    onTargetChange((current) => ({
      ...current,
      modelIds: on
        ? [
            ...current.modelIds,
            ...shownModels
              .map((model) => model.id)
              .filter((id) => !current.modelIds.includes(id)),
          ]
        : current.modelIds.filter((id) => !ids.has(id)),
    }));
  }

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

  const references = referenceAssets;

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
    const models = selectedModels.slice(0, MAX_BATCH);
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
  }, [copies, selectedModels, settings]);

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
  const canGenerate =
    !busy && prompt.trim().length > 0 && selectedModels.length > 0;

  function toggleModel(model: StudioModel) {
    onTargetChange((current) => {
      const adding = !current.modelIds.includes(model.id);
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
    // The studio clears the prompt once the batch has somewhere to go: with no
    // project picked yet, the brief stays put while the person chooses one.
    onGenerate(requests);
  }

  const modelSummary =
    selectedModels.length === 1
      ? selectedModels[0].label
      : t("modelCount", { count: selectedModels.length });

  /** True when every chosen model picks its own output format. */
  const modelChoosesFormat = shared.outputFormats.length === 0;

  const optionSummary = [
    settings.aspectRatio,
    settings.resolution,
    // Omitted when the models choose: naming a format the request will not
    // carry is the summary describing a different generation from the one the
    // button buys.
    modelChoosesFormat ? null : settings.outputFormat,
    plan.copies > 1 ? t("copyCount", { count: plan.copies }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      aria-label={labels.composerTitle}
      className="min-w-0 shrink-0 space-y-2"
    >
      {showTemplates ? (
        <StudioTemplateStrip
          labels={labels}
          onApplyTemplate={onApplyTemplate}
        />
      ) : null}
      {/* The chat room's own composer card, minus the formatting toolbar: same
          border, radius, padding and text size, so the two read as one. */}
      <RoomMessageComposer
        attachments={[]}
        belowEditor={
          <>
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
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button className={TRIGGER_CLASS} size="sm" variant="ghost">
                  <TriggerLabel label={labels.model}>
                    {modelSummary}
                  </TriggerLabel>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-96 max-w-[calc(100vw-2rem)] p-2"
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
                      className="h-7 px-2 text-xs"
                      disabled={shownModels.every((model) =>
                        selectedModelIds.includes(model.id),
                      )}
                      onClick={() => setShown(true)}
                      size="sm"
                      variant="ghost"
                    >
                      {labels.selectAllModels}
                    </Button>
                    <Button
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
                <div
                  className="app-scrollbar max-h-80 overflow-y-auto"
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
                      clampToModel(model, settings),
                    );
                    const checked = selectedModelIds.includes(model.id);
                    return (
                      <button
                        aria-checked={checked}
                        className="hover:bg-accent focus-visible:ring-ring-halo flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-[3px]"
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
                            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                              {credits === null
                                ? labels.creditsNoFigure
                                : t("creditsCount", { count: credits })}
                            </span>
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
                <Button className={TRIGGER_CLASS} size="sm" variant="ghost">
                  <TriggerLabel label={labels.moreOptions}>
                    {optionSummary}
                  </TriggerLabel>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-80 max-w-[calc(100vw-2rem)] space-y-3"
              >
                {/* Every row below reads its options from the chosen models, so
                with none chosen they are all empty. Saying so beats three
                labelled rows with nothing in them. */}
                {selectedModels.length === 0 ? (
                  <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                    {labels.noModelSelected}
                  </p>
                ) : null}

                <Row label={labels.aspectRatio}>
                  {shared.aspectRatios.map((ratio) => (
                    <button
                      aria-pressed={settings.aspectRatio === ratio}
                      className={chipClass(settings.aspectRatio === ratio)}
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

                {/* Hidden rather than empty when every chosen model picks its own
                format — an `outputFormats: []` row in Core's catalog means the
                model decides, and a labelled row with no chips in it reads as
                a control that is broken. */}
                {modelChoosesFormat ? null : (
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
                )}

                <Row label={labels.copies}>
                  {COPY_CHOICES.map((count) => {
                    // Against the models that will actually run, and against the
                    // plan rather than the raw choice: this is where the ceiling
                    // becomes visible, so `plan.copies` is what reads as pressed.
                    const overCeiling =
                      selectedModels.length * count > MAX_BATCH && count > 1;
                    /**
                     * Why this one is unavailable, in its own arithmetic.
                     *
                     * The ceiling is unchanged; only the explaining is new. A
                     * dimmed "3" beside a footnote about a limit left a sighted
                     * reader to do the multiplication and a screen-reader user with
                     * "3, dimmed" and nothing at all.
                     */
                    const reason = overCeiling
                      ? t("copiesOverCeiling", {
                          models: selectedModels.length,
                          copies: count,
                          images: selectedModels.length * count,
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
                <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
                  {t("batchCeiling", { count: MAX_BATCH })}
                </p>
              </PopoverContent>
            </Popover>

            {totalJobs > 0 ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    className="text-muted-foreground hover:text-foreground h-8 min-w-0 px-2 text-sm font-medium"
                    size="sm"
                    variant="ghost"
                  >
                    <span className="min-w-0 truncate tabular-nums">
                      {batchCredits === null
                        ? t("runPlan", {
                            copies: plan.copies,
                            models: plan.models.length,
                          })
                        : t("runPlanCredits", {
                            copies: plan.copies,
                            models: plan.models.length,
                            credits: batchCredits,
                          })}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-88 max-w-[calc(100vw-2rem)] space-y-3"
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

                  <ul className="space-y-2">
                    {plan.models.map((model) => {
                      const credits = creditsForImage(
                        model,
                        clampToModel(model, settings),
                      );
                      return (
                        <li key={model.id}>
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
                            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring-halo mt-0.5 inline-block rounded text-xs underline underline-offset-2 outline-none focus-visible:ring-[3px]"
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
          </>
        }
        withOuterPadding={false}
        withSafeAreaPadding
      >
        <Textarea
          aria-label={labels.promptPlaceholder}
          className={ROOM_COMPOSER_TEXTAREA_CLASSNAME}
          onChange={(event) => onPromptChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.shiftKey || event.metaKey || event.ctrlKey)
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
