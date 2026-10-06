"use client";

import { Check, Dices, Download, Loader2, Quote, Shuffle } from "lucide-react";
import { useFormatter } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { resolveModel } from "./catalog";
import { StudioImage } from "./studio-image";
import {
  assetContentUrl,
  epochMs,
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
  onReroll,
  onReusePrompt,
  onToggleSelect,
  onVariation,
  queued,
  selectedIds,
  showProject,
}: {
  activeJobs: StudioJob[];
  assets: StudioAsset[];
  /** Jobs the provider has agreed to stop, which may still finish anyway. */
  cancelRequestedJobIds: string[];
  catalog: StudioCatalog;
  labels: StudioLabels;
  onCancelJob: (jobId: string) => void;
  onOpen: (assetId: string) => void;
  /** Same brief, same settings, no reference: another draw of the dice. */
  onReroll: (asset: StudioAsset) => void;
  /** Put this image's prompt back in the composer to edit. */
  onReusePrompt: (asset: StudioAsset) => void;
  onToggleSelect: (assetId: string) => void;
  /** Same brief with this image as the reference. */
  onVariation: (asset: StudioAsset) => void;
  /** Requests still held in this page, not yet accepted by Core. */
  queued: QueuedGeneration[];
  selectedIds: string[];
  /** Label each image with its project: the workspace view mixes them. */
  showProject: boolean;
}) {
  const format = useFormatter();

  // Chat order: oldest at the top, newest (and anything in flight) at the
  // bottom. Grouping is one pass: a new group starts whenever the calendar day
  // changes. Local day, because "yesterday" is the reader's.
  const groups: { day: string; date: Date; assets: StudioAsset[] }[] = [];
  for (const asset of [...assets].reverse()) {
    const ms = epochMs(asset.createdAt);
    const date = new Date(ms ?? 0);
    const day = ms === null ? "" : date.toDateString();
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.assets.push(asset);
    else groups.push({ day, date, assets: [asset] });
  }

  return (
    // Named by the heading the studio renders above it, rather than by a
    // duplicate label nobody can see.
    <section aria-labelledby="studio-gallery-heading" className="min-w-0">
      {groups.map((group) => (
        <div className="mt-6 first:mt-0" key={group.day || "undated"}>
          {group.day ? (
            <h3
              className="text-muted-foreground mb-3 text-xs font-medium"
              suppressHydrationWarning
            >
              {format.dateTime(group.date, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </h3>
          ) : null}
          <ul className={GRID_CLASS}>
            {group.assets.map((asset) => {
              const selected = selectedIds.includes(asset.id);
              const model = resolveModel(catalog, asset.model);

              return (
                <li
                  className="motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 mb-3 break-inside-avoid duration-300"
                  key={asset.id}
                >
                  <figure
                    className={cn(
                      "group bg-card-background relative overflow-hidden rounded-xl transition-[background-color,transform,box-shadow] duration-200 motion-safe:hover:-translate-y-0.5 hover:shadow-md",
                      selected && "ring-primary ring-2",
                    )}
                    data-asset-id={asset.id}
                  >
                    <button
                      aria-label={`${labels.openDetails} — ${showProject ? `${asset.projectName}, ` : ""}${labels.version} ${asset.version}, ${model.label}`}
                      className="focus-visible:ring-ring-halo block w-full cursor-pointer outline-none focus-visible:ring-[3px]"
                      onClick={() => onOpen(asset.id)}
                      type="button"
                    >
                      {/* The image's own ratio, so 1:1 and 16:9 tiles pack into
                      the columns without cropping or letterboxing. */}
                      <span
                        className="bg-muted flex w-full items-center justify-center"
                        style={{
                          aspectRatio: `${asset.width} / ${asset.height}`,
                        }}
                      >
                        <StudioImage asset={asset} labels={labels} />
                      </span>
                    </button>

                    {showProject ? (
                      <figcaption className="bg-background text-foreground border-border pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-md border px-2 py-0.5 text-xs">
                        {asset.projectName}
                      </figcaption>
                    ) : null}

                    {/* Actions live on the picture, on hover or focus, so the
                    grid stays a wall of images and the second draw is one
                    click. Always shown where there is no hover to wait for. */}
                    <div
                      className={cn(
                        "absolute inset-x-0 top-0 flex justify-end gap-1 p-2 pl-10",
                        "opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
                      )}
                    >
                      <HoverAction
                        label={labels.reroll}
                        onClick={() => onReroll(asset)}
                      >
                        <Dices aria-hidden className="size-3.5" />
                      </HoverAction>
                      <HoverAction
                        label={labels.regenerate}
                        onClick={() => onVariation(asset)}
                      >
                        <Shuffle aria-hidden className="size-3.5" />
                      </HoverAction>
                      <HoverAction
                        label={labels.reusePrompt}
                        onClick={() => onReusePrompt(asset)}
                      >
                        <Quote aria-hidden className="size-3.5" />
                      </HoverAction>
                      <a
                        aria-label={labels.download}
                        className={HOVER_ACTION_CLASS}
                        download={`v${asset.version}.${asset.settings?.outputFormat ?? "png"}`}
                        href={assetContentUrl(asset)}
                        title={labels.download}
                      >
                        <Download aria-hidden className="size-3.5" />
                      </a>
                    </div>

                    {/* Selection is its own control, and always drawn: an
                    empty box that only appears on hover cannot be found on
                    touch and is not a thing a keyboard user can see coming. */}
                    <button
                      aria-label={selected ? labels.deselect : labels.select}
                      aria-pressed={selected}
                      className={cn(
                        "hit-area absolute top-2 left-2 flex size-6 items-center justify-center rounded-md border shadow-sm transition-colors",
                        "focus-visible:ring-ring-halo outline-none focus-visible:ring-[3px]",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => onToggleSelect(asset.id)}
                      type="button"
                    >
                      {selected ? (
                        <Check aria-hidden className="size-3.5" />
                      ) : null}
                    </button>
                  </figure>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <ul className={cn(GRID_CLASS, groups.length > 0 && "mt-6")}>
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
                <Button
                  className="mt-2"
                  disabled={requested}
                  onClick={() => onCancelJob(job.id)}
                  size="sm"
                  variant="ghost"
                >
                  {requested ? labels.cancelRequested : labels.cancel}
                </Button>
              </PendingTile>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** CSS columns: a masonry that keeps each image at its own ratio. */
const GRID_CLASS = cn(
  "list-none columns-2 gap-3 sm:columns-3",
  "lg:columns-4 xl:columns-5 2xl:columns-6",
);

const HOVER_ACTION_CLASS = cn(
  "bg-background text-foreground border-border flex size-10 md:size-8 items-center justify-center rounded-md border",
  "hover:bg-background focus-visible:ring-ring-halo outline-none focus-visible:ring-[3px]",
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
    <button
      aria-label={label}
      className={HOVER_ACTION_CLASS}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
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
