"use client";

import { Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
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
 * be read together. The picture carries the judgement; the caption carries
 * only what you cannot see by looking — which version it is, whether it has
 * been decided on, which model made it and what it was made for. Its exact
 * pixel size, its prompt, its lineage and its note are one click away, which
 * is where things you compare rather than scan belong.
 */
export function StudioGallery({
  activeJobs,
  assets,
  cancelRequestedJobIds,
  catalog,
  labels,
  onCancelJob,
  onOpen,
  onToggleSelect,
  projectId,
  queued,
  selectedIds,
}: {
  activeJobs: StudioJob[];
  assets: StudioAsset[];
  /** Jobs the provider has agreed to stop, which may still finish anyway. */
  cancelRequestedJobIds: string[];
  catalog: StudioCatalog;
  labels: StudioLabels;
  onCancelJob: (jobId: string) => void;
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

        {activeJobs.map((job) => {
          const requested = cancelRequestedJobIds.includes(job.id);
          return (
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
              >
                {/* Cancelling belongs on the thing being cancelled. As a row
                    of buttons above the gallery it was a second list of the
                    running jobs, in a different order, with no picture. */}
                <Button
                  className="mt-1"
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
          // Everything the caption cannot fit, kept reachable on hover and
          // for the accessible name.
          const provenance = [
            model.label,
            `${asset.width}×${asset.height}`,
            placement
              ? `${placementName(placement)} · ${placement.aspectRatio} · ${placement.width}×${placement.height}`
              : null,
            model.known ? null : labels.modelNotInCatalog,
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <li key={asset.id}>
              <figure
                className={cn(
                  "group border-border bg-background relative overflow-hidden rounded-lg border transition-colors",
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

                {/* The decision belongs on the picture: it is a fact about
                    the image, and on the caption line it competed with the
                    model name for the one line both had to share. */}
                {decision ? (
                  <Badge
                    tone={decision === "APPROVED" ? "approved" : "rejected"}
                  >
                    {decision === "APPROVED" ? (
                      <Check aria-hidden className="size-3" />
                    ) : (
                      <X aria-hidden className="size-3" />
                    )}
                    {decision === "APPROVED"
                      ? labels.approved
                      : labels.rejected}
                  </Badge>
                ) : null}

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
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => onToggleSelect(asset.id)}
                  type="button"
                >
                  {selected ? <Check aria-hidden className="size-3.5" /> : null}
                </button>

                <figcaption className="space-y-0.5 px-2 py-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="text-foreground shrink-0 text-xs font-medium tabular-nums">
                      v{asset.version}
                    </span>
                    {/* Requirement: the model is readable on the image
                        itself, never only in a detail view someone has to
                        open. */}
                    <span
                      className={cn(
                        "text-muted-foreground min-w-0 flex-1 truncate text-xs",
                        model.known || "font-mono",
                      )}
                      title={provenance}
                    >
                      {model.label}
                    </span>
                  </div>

                  {placement ? (
                    // Its own line: with the platform prefix these names do
                    // not survive sharing a row with anything, and the
                    // platform is the part that tells two Reels placements
                    // apart.
                    <p
                      className="text-muted-foreground truncate text-xs"
                      title={provenance}
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
        "absolute top-2 left-2 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium",
        // Never colour alone: each badge carries its own icon and word.
        tone === "approved"
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-muted-foreground",
      )}
    >
      {children}
    </span>
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
        "border-border bg-background flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-3 text-center",
        variant === "queued" && "opacity-70",
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
      <p className="text-muted-foreground w-full truncate text-xs">{model}</p>
      <p className="text-muted-foreground line-clamp-2 text-xs opacity-70">
        {prompt}
      </p>
      {children}
    </div>
  );
}
