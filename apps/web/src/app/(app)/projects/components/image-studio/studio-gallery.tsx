"use client";

import { Check, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { placementById, placementName, resolveModel } from "./catalog";
import { StudioImage } from "./studio-image";
import type {
  StudioAsset,
  StudioCatalog,
  StudioJob,
  StudioLabels,
} from "./types";
import type { QueuedGeneration } from "./use-generation-queue";

/**
 * The gallery, and the reason it is the page rather than a strip under one.
 *
 * Bulk creation only means anything if the results arrive somewhere they can
 * be read together. Everything a person needs to judge an image without
 * opening it is on the tile: which model made it, how it is framed, what it
 * was made for, and whether it has been decided on. Opening one is for the
 * prompt, the lineage and the note.
 */
export function StudioGallery({
  activeJobs,
  assets,
  catalog,
  labels,
  onOpen,
  onToggleSelect,
  projectId,
  queued,
  selectedIds,
}: {
  activeJobs: StudioJob[];
  assets: StudioAsset[];
  catalog: StudioCatalog;
  labels: StudioLabels;
  onOpen: (assetId: string) => void;
  onToggleSelect: (assetId: string) => void;
  projectId: string;
  /** Requests still held in this page, not yet accepted by Core. */
  queued: QueuedGeneration[];
  selectedIds: string[];
}) {
  return (
    <section aria-label={labels.gallery} className="min-w-0">
      <ul
        className={cn(
          "grid list-none grid-cols-2 gap-3 sm:grid-cols-3",
          "lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
        )}
      >
        {queued.map((request) => (
          <li key={request.id}>
            <PendingTile
              label={labels.waitingForSlot}
              model={request.modelLabel}
              prompt={request.prompt}
              variant="queued"
            />
          </li>
        ))}

        {activeJobs.map((job) => (
          <li key={job.id}>
            <PendingTile
              label={
                job.status === "QUEUED" || job.status === "PENDING"
                  ? labels.queued
                  : labels.generating
              }
              model={resolveModel(catalog, job.model).label}
              prompt={job.prompt}
              variant="running"
            />
          </li>
        ))}

        {assets.map((asset) => {
          const selected = selectedIds.includes(asset.id);
          const model = resolveModel(catalog, asset.model);
          const placement = placementById(
            catalog,
            asset.settings?.placementId ?? null,
          );
          const decision = asset.review?.decision ?? null;
          const decisionLabel =
            decision === "APPROVED"
              ? labels.approved
              : decision === "REJECTED"
                ? labels.rejected
                : labels.undecided;

          return (
            <li key={asset.id}>
              <figure
                className={cn(
                  "group border-border bg-card-background relative overflow-hidden rounded-xl border transition-colors",
                  selected && "border-primary ring-ring-halo ring-2",
                )}
                data-asset-id={asset.id}
              >
                <button
                  aria-label={`${labels.openDetails} — ${labels.version} ${asset.version}, ${model.label}, ${decisionLabel}`}
                  className="focus-visible:ring-ring-halo block w-full cursor-pointer outline-none focus-visible:ring-[3px]"
                  onClick={() => onOpen(asset.id)}
                  type="button"
                >
                  <span className="bg-muted flex aspect-square w-full items-center justify-center">
                    <StudioImage
                      asset={asset}
                      label={labels.bytesUnavailable}
                      projectId={projectId}
                    />
                  </span>
                </button>

                {/* Selection is its own control: clicking the picture opens
                    it, which is what a picture in a gallery should do. */}
                <button
                  aria-label={selected ? labels.deselect : labels.select}
                  aria-pressed={selected}
                  className={cn(
                    "absolute top-2 right-2 flex size-6 items-center justify-center rounded-md border transition-colors",
                    "focus-visible:ring-ring-halo outline-none focus-visible:ring-[3px]",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card-background text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => onToggleSelect(asset.id)}
                  type="button"
                >
                  {selected ? <Check aria-hidden className="size-3.5" /> : null}
                </button>

                <figcaption className="space-y-1.5 p-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-foreground text-xs font-medium tabular-nums">
                      v{asset.version}
                    </span>
                    {decision === "APPROVED" ? (
                      <Badge tone="approved">
                        <Check aria-hidden className="size-3" />
                        {labels.approved}
                      </Badge>
                    ) : decision === "REJECTED" ? (
                      <Badge tone="rejected">
                        <X aria-hidden className="size-3" />
                        {labels.rejected}
                      </Badge>
                    ) : null}
                  </div>

                  {/* Requirement: the model is readable on the image itself,
                      never only in a detail view someone has to open. */}
                  <p
                    className={cn(
                      "truncate text-xs",
                      model.known
                        ? "text-muted-foreground"
                        : "text-muted-foreground font-mono",
                    )}
                    title={
                      model.known
                        ? model.label
                        : `${labels.modelNotInCatalog} — ${model.label}`
                    }
                  >
                    {model.label}
                  </p>

                  <p className="text-muted-foreground text-xs tabular-nums">
                    {asset.width}×{asset.height}
                  </p>
                  {placement ? (
                    // Its own line: with the platform prefix these names do
                    // not survive sharing a row with the dimensions, and the
                    // platform is the part that tells two Reels placements
                    // apart.
                    <p
                      className="text-muted-foreground truncate text-xs"
                      title={`${placementName(placement)} · ${placement.aspectRatio} · ${placement.width}×${placement.height}`}
                    >
                      {placementName(placement)}
                    </p>
                  ) : null}
                </figcaption>
              </figure>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "approved" | "rejected";
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 rounded px-1 py-0.5 text-xs font-medium",
        // Never colour alone: each badge carries its own icon and word.
        tone === "approved"
          ? "bg-primary-tertiary text-foreground"
          : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function PendingTile({
  label,
  model,
  prompt,
  variant,
}: {
  label: string;
  model: string;
  prompt: string;
  variant: "queued" | "running";
}) {
  return (
    <div
      className={cn(
        "border-border bg-card-background flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center",
        variant === "queued" ? "border-dashed opacity-70" : "border-dashed",
      )}
    >
      <Loader2
        aria-hidden
        className={cn(
          "text-muted-foreground size-4",
          variant === "running" && "animate-spin",
        )}
      />
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-muted-foreground truncate text-xs">{model}</p>
      <p className="text-muted-foreground line-clamp-2 text-xs opacity-70">
        {prompt}
      </p>
    </div>
  );
}
