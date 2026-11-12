"use client";

import type { SetStudioAssetFeedbackData } from "@sokosumi/core-client";
import {
  Check,
  Dices,
  Download,
  Loader2,
  Play,
  Quote,
  Shuffle,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { resolveModel, supportsVariation } from "./catalog";
import { StudioImage } from "./studio-image";
import { StudioAssetMenu, StudioRating } from "./studio-rating";
import {
  assetContentUrl,
  assetFileExtension,
  epochMs,
  isVideoAsset,
  type StudioAsset,
  type StudioCatalog,
  type StudioJob,
  type StudioLabels,
} from "./types";
import type { QueuedGeneration } from "./use-generation-queue";

/**
 * The gallery, and the reason it is the page rather than a strip under one.
 *
 * Bulk creation only means anything if the results arrive somewhere they can
 * be read together. So it is a bare wall of pictures at their own ratios: no
 * captions, because the picture carries the judgement. The prompt, model,
 * time and credits are one click away in the viewer.
 */
export function StudioGallery({
  activeJobs,
  assets,
  cancelRequestedJobIds,
  catalog,
  labels,
  onCancelJob,
  onOpen,
  onRate,
  onHide,
  ratingBusyIds = [],
  sort = "newest",
  onSortChange,
  onReroll,
  onReusePrompt,
  onToggleSelect,
  onVariation,
  queued,
  selectedIds,
}: {
  activeJobs: StudioJob[];
  assets: StudioAsset[];
  /** Jobs the provider has agreed to stop, which may still finish anyway. */
  cancelRequestedJobIds: string[];
  catalog: StudioCatalog;
  labels: StudioLabels;
  /** Omitted, with the draw actions below, in a read-only studio. */
  onCancelJob?: (jobId: string) => void;
  onOpen: (assetId: string) => void;
  onRate?: (
    asset: StudioAsset,
    input: SetStudioAssetFeedbackData["body"],
  ) => void;
  onHide?: (asset: StudioAsset) => void;
  ratingBusyIds?: string[];
  sort?: "newest" | "best";
  onSortChange?: (sort: "newest" | "best") => void;
  /** Same brief, same settings, no reference: another draw of the dice. */
  onReroll?: (asset: StudioAsset) => void;
  /** Put this image's prompt back in the composer to edit. */
  onReusePrompt?: (asset: StudioAsset) => void;
  onToggleSelect: (assetId: string) => void;
  /** Same brief with this image as the reference. */
  onVariation?: (asset: StudioAsset) => void;
  /** Requests still held in this page, not yet accepted by Core. */
  queued: QueuedGeneration[];
  selectedIds: string[];
}) {
  const format = useFormatter();
  const t = useTranslations("App.Studio");
  const [groupByProduct, setGroupByProduct] = useState(true);
  const hasProducts = assets.some((asset) => asset.product);

  // Chat order: oldest at the top, newest (and anything in flight) at the
  // bottom. Grouping is one pass: a new group starts whenever the calendar day
  // changes. Local day, because "yesterday" is the reader's.
  // Product groups can span days. Put the group with the newest ad nearest
  // the composer, and use that ad's saved name after a product is renamed.
  const groups = new Map<
    string,
    { title: string; projectName?: string; assets: StudioAsset[] }
  >();
  const ordered =
    sort === "best"
      ? [...assets].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      : [...assets].reverse();
  for (const asset of ordered) {
    const ms = epochMs(asset.createdAt);
    const date = ms === null ? null : new Date(ms);
    const product =
      groupByProduct && sort !== "best" ? asset.product : undefined;
    const key =
      sort === "best"
        ? "best"
        : product
          ? `product:${asset.projectId}:${product.id}`
          : `date:${date?.toDateString() ?? ""}`;
    const group = groups.get(key);
    if (group) {
      group.assets.push(asset);
      if (product) group.title = product.name;
      groups.delete(key);
      groups.set(key, group);
      continue;
    }
    groups.set(key, {
      title:
        sort === "best"
          ? ""
          : (product?.name ??
            (date
              ? format.dateTime(date, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })
              : "")),
      projectName: product ? asset.projectName : undefined,
      assets: [asset],
    });
  }

  return (
    // Named by the heading the studio renders above it, rather than by a
    // duplicate label nobody can see.
    <section aria-labelledby="studio-gallery-heading" className="min-w-0">
      <h2 className="sr-only" id="studio-gallery-heading">
        {t("adGallery")}
      </h2>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {onSortChange ? (
          <GallerySort onSortChange={onSortChange} sort={sort} />
        ) : null}
        {hasProducts && sort !== "best" ? (
          <Button
            aria-pressed={groupByProduct}
            onClick={() => setGroupByProduct((current) => !current)}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("groupByProduct")}
          </Button>
        ) : null}
      </div>
      {[...groups].map(([key, group]) => (
        <div className="mt-6 first-of-type:mt-0" key={key}>
          {group.title ? (
            <h3
              className="text-muted-foreground mb-3 text-xs font-medium break-words"
              suppressHydrationWarning
            >
              {group.title}
              {group.projectName ? ` · ${group.projectName}` : null}
            </h3>
          ) : null}
          <ul className={GRID_CLASS}>
            {group.assets.map((asset) => {
              const selected = selectedIds.includes(asset.id);
              const model = resolveModel(catalog, asset.model);
              const video = isVideoAsset(asset);

              return (
                <li
                  className="motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 mb-3 break-inside-avoid duration-300"
                  key={asset.id}
                >
                  <figure
                    className={cn(
                      "group bg-card-background border-border relative overflow-hidden rounded-xl border transition-colors duration-200 hover:bg-card-background-hover",
                      selected && "ring-ring ring-2",
                    )}
                    data-asset-id={asset.id}
                  >
                    <button
                      aria-label={`${labels.openDetails} — ${labels.version} ${asset.version}, ${model.label}`}
                      className="focus-visible:ring-ring block w-full cursor-pointer outline-none focus-visible:ring-2"
                      onClick={() => onOpen(asset.id)}
                      type="button"
                    >
                      {/* The image's own ratio, so 1:1 and 16:9 tiles pack into
                      the columns without cropping or letterboxing. */}
                      <span
                        className="bg-muted flex w-full items-center justify-center"
                        style={{ aspectRatio: tileAspectRatio(asset) }}
                      >
                        <StudioImage asset={asset} labels={labels} />
                      </span>
                      {video ? (
                        <span className="bg-background text-foreground border-border pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs tabular-nums">
                          <Play aria-hidden className="size-3" />
                          {asset.video?.durationSeconds
                            ? `${asset.video.durationSeconds}s`
                            : null}
                        </span>
                      ) : null}
                    </button>

                    {/* Actions live on the picture, on hover or focus, so the
                    grid stays a wall of images and the second draw is one
                    click. Always shown where there is no hover to wait for. */}
                    <div
                      className={cn(
                        // Four `size-10` actions do not fit a two-column tile.
                        // The figure is `overflow-hidden`, so a single row
                        // clips the ones that stick out.
                        "absolute inset-x-0 top-0 flex flex-wrap justify-end gap-1 p-2 pl-10",
                        "opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
                      )}
                    >
                      {video || !onReroll ? null : (
                        <HoverAction
                          label={labels.reroll}
                          onClick={() => onReroll(asset)}
                        >
                          <Dices aria-hidden className="size-3.5" />
                        </HoverAction>
                      )}
                      {onVariation &&
                      !video &&
                      supportsVariation(catalog, asset.model) ? (
                        <HoverAction
                          label={labels.regenerate}
                          onClick={() => onVariation(asset)}
                        >
                          <Shuffle aria-hidden className="size-3.5" />
                        </HoverAction>
                      ) : null}
                      {onReusePrompt ? (
                        <HoverAction
                          label={labels.reusePrompt}
                          onClick={() => onReusePrompt(asset)}
                        >
                          <Quote aria-hidden className="size-3.5" />
                        </HoverAction>
                      ) : null}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <a
                            aria-label={labels.download}
                            className={HOVER_ACTION_CLASS}
                            download={`v${asset.version}.${assetFileExtension(asset)}`}
                            href={assetContentUrl(asset, { download: true })}
                          >
                            <Download aria-hidden className="size-3.5" />
                          </a>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" sideOffset={6}>
                          {labels.download}
                        </TooltipContent>
                      </Tooltip>
                    </div>

                    {onRate || onHide ? (
                      <div className="bg-background relative flex flex-wrap items-end justify-between gap-1 p-2 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 md:absolute md:inset-x-0 md:bottom-0 md:bg-transparent md:opacity-0 [@media(hover:none)]:opacity-100">
                        {onRate ? (
                          <StudioRating
                            asset={asset}
                            busy={ratingBusyIds.includes(asset.id)}
                            onRate={onRate}
                          />
                        ) : (
                          <span />
                        )}
                        {onHide ? (
                          <StudioAssetMenu
                            busy={ratingBusyIds.includes(asset.id)}
                            onHide={() => onHide(asset)}
                          />
                        ) : null}
                      </div>
                    ) : null}

                    {/* Selection is its own control, and always drawn: an
                    empty box that only appears on hover cannot be found on
                    touch and is not a thing a keyboard user can see coming.
                    A video is never a reference, so it has none. */}
                    {video ? null : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            aria-label={
                              selected ? labels.deselect : labels.select
                            }
                            aria-pressed={selected}
                            className={cn(
                              "hit-area absolute top-2 left-2 flex size-6 items-center justify-center rounded-md border transition-colors",
                              "focus-visible:ring-ring outline-none focus-visible:ring-2",
                              selected
                                ? "border-foreground bg-primary text-primary-foreground"
                                : "border-border bg-background text-muted-foreground hover:text-foreground",
                            )}
                            onClick={() => onToggleSelect(asset.id)}
                            type="button"
                          >
                            {selected ? (
                              <Check aria-hidden className="size-3.5" />
                            ) : null}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" sideOffset={6}>
                          {selected ? labels.deselect : labels.select}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </figure>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <ul className={cn(GRID_CLASS, groups.size > 0 && "mt-6")}>
        {queued.map((request) => (
          <li className="mb-3 break-inside-avoid" key={request.id}>
            <PendingTile
              label={labels.waitingForSlot}
              model={request.modelLabel}
              prompt={request.prompt}
              variant="queued"
            />
          </li>
        ))}

        {activeJobs.map((job) => {
          const requested = cancelRequestedJobIds.includes(job.id);
          return (
            <li className="mb-3 break-inside-avoid" key={job.id}>
              <PendingTile
                label={
                  job.status === "QUEUED" || job.status === "PENDING"
                    ? labels.queued
                    : labels.generating
                }
                model={resolveModel(catalog, job.model).label}
                prompt={job.prompt}
                variant="running"
              >
                {/* Cancelling belongs on the thing being cancelled. As a row
                    of buttons above the gallery it was a second list of the
                    running jobs, in a different order, with no picture. */}
                {onCancelJob ? (
                  <Button
                    className="mt-2"
                    disabled={requested}
                    onClick={() => onCancelJob(job.id)}
                    size="sm"
                    variant="ghost"
                  >
                    {requested ? labels.cancelRequested : labels.cancel}
                  </Button>
                ) : null}
              </PendingTile>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The tile's frame before the bytes load: the stored size, or a text-to-video
 * clip's requested ratio. An animated image has neither and takes the video's
 * own size once its metadata arrives.
 */
function tileAspectRatio(asset: StudioAsset): string | undefined {
  if (asset.width > 0 && asset.height > 0)
    return `${asset.width} / ${asset.height}`;
  const ratio = asset.video?.aspectRatio;
  return ratio ? ratio.replace(":", " / ") : undefined;
}

/** CSS columns: a masonry that keeps each image at its own ratio. */
const GRID_CLASS = cn(
  "list-none columns-2 gap-3 sm:columns-3",
  "lg:columns-4 xl:columns-5 2xl:columns-6",
);

const HOVER_ACTION_CLASS = cn(
  "bg-background text-foreground border-border flex size-10 md:size-8 items-center justify-center rounded-md border",
  "hover:bg-background focus-visible:ring-ring outline-none focus-visible:ring-2",
);

function HoverAction({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className={HOVER_ACTION_CLASS}
          onClick={onClick}
          type="button"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function PendingTile({
  children,
  label,
  model,
  prompt,
  variant,
}: {
  children?: React.ReactNode;
  label: string;
  model: string;
  prompt: string;
  variant: "queued" | "running";
}) {
  return (
    <div
      className={cn(
        "bg-card-background flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl p-3 text-center",
        variant === "queued" && "opacity-70",
      )}
    >
      <Loader2
        aria-hidden
        className={cn(
          "text-muted-foreground size-4",
          variant === "running" && "animate-spin motion-reduce:animate-pulse",
        )}
      />
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-muted-foreground w-full truncate text-xs">{model}</p>
      {/* No second dimming: `text-muted-foreground` is already the quiet
          role, and stacking `opacity-70` on it took this line under the
          contrast floor for the sake of looking quieter still. */}
      <p className="text-muted-foreground line-clamp-2 text-xs">{prompt}</p>
      {children}
    </div>
  );
}

function GallerySort({
  sort,
  onSortChange,
}: {
  sort: "newest" | "best";
  onSortChange: (sort: "newest" | "best") => void;
}) {
  const t = useTranslations("App.Studio.Rating");
  const [querySort, setQuerySort] = useQueryState(
    "sort",
    parseAsStringLiteral(["newest", "best"]).withDefault("newest"),
  );
  // Back/forward and shared URLs select the same Core ordering as this control.
  useEffect(() => {
    onSortChange(querySort);
  }, [querySort, onSortChange]);
  return (
    <select
      aria-label={t("sort")}
      className="border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-2 text-sm focus-visible:ring-2 md:h-8"
      onChange={(event) => {
        const next = event.target.value === "best" ? "best" : "newest";
        onSortChange(next);
        void setQuerySort(next);
      }}
      value={sort}
    >
      <option value="newest">{t("newest")}</option>
      <option value="best">{t("best")}</option>
    </select>
  );
}
