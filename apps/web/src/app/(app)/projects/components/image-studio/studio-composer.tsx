"use client";

import { ChevronDown, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
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
 * Where a generation is described and bought.
 *
 * Three things make this different from a prompt box. Models are a
 * multi-select, because the reason to name a model at all is usually to see
 * two of them answer the same brief. Placement is a real choice with the
 * platform's own numbers on it, stated as a target rather than a promise.
 * And every option offered — every ratio, every resolution, every format —
 * is read from the model's entry in Core's verified catalog, so the composer
 * cannot offer a combination the provider will refuse.
 */
export function StudioComposer({
  busy,
  catalog,
  labels,
  onGenerate,
  onTargetChange,
  projectId,
  referenceAssets,
  onClearReferences,
  target,
}: {
  busy: boolean;
  catalog: StudioCatalog;
  labels: StudioLabels;
  onGenerate: (requests: QueuedGeneration[]) => void;
  /**
   * The chips are shared with the assistant, so the page owns them.
   *
   * An updater rather than a value: two chips clicked in the same tick are
   * batched, and computing the second from the render's stale `target` threw
   * the first one away. Selecting two models quickly is the normal way to use
   * this composer, so that was not a rare case.
   */
  onTargetChange: (update: (current: StudioTarget) => StudioTarget) => void;
  projectId: string;
  /** Images the person picked in the gallery to generate *from*. */
  referenceAssets: StudioAsset[];
  onClearReferences: () => void;
  target: StudioTarget;
}) {
  // Only for the strings that interpolate a count; see `StudioLabels`.
  const t = useTranslations("App.Projects.Detail.imageStudio");
  const [prompt, setPrompt] = useState("");
  const [copies, setCopies] = useState(1);
  /**
   * Frame, resolution, format and copies start folded away.
   *
   * Unfolded, the settings were taller than the gallery they sit above, which
   * made a gallery-first studio open on a form. They are summarised in the
   * toggle, so nothing is hidden — only the rows you are not currently
   * changing. Model and placement stay out, because choosing those is the
   * point of the composer.
   */
  const [showOptions, setShowOptions] = useState(false);
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
      // selection. Its chip is already disabled, so this is the guard for
      // every other route in — keyboard, a stale render, a future caller.
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
   * Setting the placement alone was not enough. Disabling a model's chip
   * stops it being *added*, but a model selected beforehand stayed selected,
   * and `submit` still built a request for it — where `clampToModel` quietly
   * moved 9:16 to that model's first ratio. The result was a square image
   * carrying a Reels `placementId`: exactly the unsupported combination the
   * catalog exists to prevent, recorded as though it had been honoured.
   *
   * If nothing selected can frame the placement, the first model in the
   * catalog that can is selected instead, so the chip always does something
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
    setPrompt("");
  }

  return (
    <section
      aria-label={labels.composerTitle}
      className="border-border bg-card-background rounded-xl border"
    >
      <div className="p-3 sm:p-4">
        <Textarea
          aria-label={labels.promptPlaceholder}
          className="max-h-48 min-h-20 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 md:text-sm"
          onChange={(event) => setPrompt(event.currentTarget.value)}
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

      <div className="border-border space-y-3 border-t p-3 sm:p-4">
        <Row label={labels.model}>
          {catalog.models.map((model) => {
            const active = selectedModelIds.includes(model.id);
            const blocked = Boolean(
              placement && !modelSupportsPlacement(model, placement),
            );
            return (
              <button
                aria-pressed={active}
                className={chipClass(active, blocked)}
                disabled={blocked}
                key={model.id}
                onClick={() => toggleModel(model)}
                title={
                  blocked
                    ? labels.modelUnsupportedForPlacement
                    : `${model.description} — ${model.notes}`
                }
                type="button"
              >
                {model.label}
              </button>
            );
          })}
        </Row>

        <Row label={labels.placement}>
          <button
            aria-pressed={placementId === null}
            className={chipClass(placementId === null)}
            onClick={() => choosePlacement(null)}
            type="button"
          >
            {labels.placementNone}
          </button>
          {catalog.placements.map((option) => (
            <button
              aria-pressed={placementId === option.id}
              className={chipClass(placementId === option.id)}
              key={option.id}
              onClick={() => choosePlacement(option.id)}
              title={option.notes}
              type="button"
            >
              {placementName(option)}{" "}
              <span className="font-normal opacity-70">
                {option.aspectRatio} · {option.width}×{option.height}
              </span>
            </button>
          ))}
        </Row>

        {placement ? (
          // Core's own sourced note first, then the studio's standing caveat.
          // The note is the part that is specific and verifiable; the caveat
          // is the part that stops the pixel numbers reading as a promise.
          <div className="text-muted-foreground space-y-1 text-xs leading-relaxed">
            <p>{placement.notes}</p>
            <p>{labels.placementNotOutput}</p>
          </div>
        ) : null}

        <button
          aria-expanded={showOptions}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs font-medium transition-colors"
          onClick={() => setShowOptions((open) => !open)}
          type="button"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 transition-transform",
              showOptions && "rotate-180",
            )}
          />
          {settings.aspectRatio} · {settings.resolution} ·{" "}
          {settings.outputFormat}
          {copies > 1 ? ` · ${labels.copies} ${copies}` : ""}
        </button>

        {showOptions ? (
          <>
            <Row label={labels.aspectRatio}>
              {shared.aspectRatios.map((ratio) => (
                <button
                  aria-pressed={settings.aspectRatio === ratio}
                  className={chipClass(
                    settings.aspectRatio === ratio,
                    placement !== null,
                  )}
                  // Placement owns the frame while one is chosen; changing it here
                  // would leave the chip and the request disagreeing.
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
          </>
        ) : null}
      </div>

      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-3 py-3 sm:px-4">
        <p className="text-muted-foreground min-w-0 text-xs">
          {selectedModels.map((model) => model.label).join(" · ")}
        </p>
        <Button disabled={!canGenerate} onClick={submit} size="sm">
          {busy ? (
            <Loader2 aria-hidden className="animate-spin" />
          ) : totalJobs > 1 ? (
            <ImagePlus aria-hidden />
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
