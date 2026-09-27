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
  modelSupportsPlacement,
  placementById,
  placementName,
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
 * Four is enough for the thing this composer is for — the same prompt on
 * three models, side by side, plus one — and small enough that a mis-click
 * costs very little. Core's own per-project concurrency is lower than this on
 * purpose: the overflow waits in the queue instead of coming back as an error,
 * which is what makes asking for four feel like one action.
 */
export const MAX_BATCH = 4;

/** Copies-per-model offered. Kept short; the batch ceiling is the real limit. */
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

  const totalJobs = Math.min(selectedModels.length * copies, MAX_BATCH);
  const canGenerate =
    !busy && prompt.trim().length > 0 && selectedModels.length > 0;

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
    const requests: QueuedGeneration[] = [];
    // Round-robin across models rather than all of model A then all of model
    // B, so a batch clipped by the ceiling still covers every model asked for.
    // Belt and braces: never build a request whose model cannot frame the
    // active placement, whatever route the selection arrived by.
    const eligible = placement
      ? selectedModels.filter((model) =>
          modelSupportsPlacement(model, placement),
        )
      : selectedModels;
    outer: for (let copy = 0; copy < copies; copy += 1) {
      for (const model of eligible) {
        if (requests.length >= MAX_BATCH) break outer;
        const id = crypto.randomUUID();
        requests.push({
          id,
          prompt: prompt.trim(),
          modelId: model.id,
          modelLabel: model.label,
          settings: clampToModel(model, settings),
          parentAssetId: references[0]?.id ?? null,
          referenceAssetIds: references.map((asset) => asset.id),
          // One key per request, never shared across the batch: these are
          // deliberately different images, not retries of one.
          idempotencyKey: `ui:${id}`,
        });
      }
    }
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
    copies > 1 ? t("copyCount", { count: copies }) : null,
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
            <DropdownMenuLabel>{labels.model}</DropdownMenuLabel>
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
              {COPY_CHOICES.map((count) => (
                <button
                  aria-pressed={copies === count}
                  className={chipClass(
                    copies === count,
                    selectedModels.length * count > MAX_BATCH && count > 1,
                  )}
                  disabled={
                    selectedModels.length * count > MAX_BATCH && count > 1
                  }
                  key={count}
                  onClick={() => setCopies(count)}
                  type="button"
                >
                  {count}
                </button>
              ))}
            </Row>
          </PopoverContent>
        </Popover>

        <span className="grow" />

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
