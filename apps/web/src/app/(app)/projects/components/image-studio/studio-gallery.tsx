"use client";

import {
  Check,
  Dices,
  Download,
  Loader2,
  Quote,
  Shuffle,
  X,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { resolveModel } from "./catalog";
import { StudioImage } from "./studio-image";
import {
  assetContentUrl,
  epochMs,
  formatElapsed,
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
 * be read together. The picture carries the judgement; the caption carries
 * only what you cannot see by looking — which version it is, whether it has
 * been decided on, and which model made it. Its exact pixel size, its prompt,
 * its lineage and its note are one click away, which is where things you
 * compare rather than scan belong.
 */
export function StudioGallery({
  activeJobs,
  assets,
  cancelRequestedJobIds,
  catalog,
  creditsByAssetId,
  elapsedByAssetId,
  labels,
  onCancelJob,
  onOpen,
  onReroll,
  onReusePrompt,
  onToggleSelect,
  onVariation,
  projectId,
  queued,
  selectedIds,
}: {
  activeJobs: StudioJob[];
  assets: StudioAsset[];
  /** Jobs the provider has agreed to stop, which may still finish anyway. */
  cancelRequestedJobIds: string[];
  catalog: StudioCatalog;
  /**
   * What each version was debited, per version, in credits.
   *
   * The charge off the job row, not a figure recomputed from the catalog: a
   * price that moved since the image was made must not silently restate what
   * the person paid.
   */
  creditsByAssetId: Record<string, number>;
  /**
   * How long the provider took, per version, in milliseconds.
   *
   * Read from the jobs the state carries, so a version older than that page is
   * simply absent and its tile says nothing about time.
   */
  elapsedByAssetId: Record<string, number>;
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
  projectId: string;
  /** Requests still held in this page, not yet accepted by Core. */
  queued: QueuedGeneration[];
  selectedIds: string[];
}) {
  // Only for the credits figure, which interpolates a count; every other string
  // arrives resolved in `labels`. See `StudioLabels`.
  const t = useTranslations("App.Studio");
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
              const decision = asset.review?.decision ?? null;
              const decisionLabel =
                decision === "APPROVED"
                  ? labels.approved
                  : decision === "REJECTED"
                    ? labels.rejected
                    : labels.undecided;
              const elapsed = elapsedByAssetId[asset.id] ?? null;
              // What this version actually cost, off its job row. `?? null`, never
              // `|| null`: a job whose row has fallen off the page is absent and
              // unknown, while a delivered image Core could not charge for carries a
              // real `0` and was free. Different claims, and a falsy check would
              // collapse the second into the first.
              const credits = creditsByAssetId[asset.id] ?? null;
              // Everything the caption cannot fit, kept reachable on hover and
              // for the accessible name. The catalog id is in here rather than on
              // the caption: the label is what a person compares models by, and
              // the id is what they would quote in a bug report.
              const provenance = [
                model.label,
                model.id,
                `${asset.width}×${asset.height}`,
                elapsed === null
                  ? null
                  : `${labels.generationTime} ${formatElapsed(elapsed)}`,
                credits === null
                  ? null
                  : `${labels.credits} ${t("creditsCount", { count: credits })}`,
                model.known ? null : labels.modelNotInCatalog,
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <li key={asset.id}>
                  <figure
                    className={cn(
                      "group bg-card-background relative overflow-hidden rounded-xl transition-colors",
                      selected && "ring-primary ring-2",
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
                          labels={labels}
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

                    {/* Actions live on the picture, on hover or focus, so the grid
                    stays a wall of images and the second draw is one click.
                    Always shown where there is no hover to wait for. */}
                    <div
                      className={cn(
                        "absolute inset-x-0 top-0 flex justify-end gap-1 p-2 pr-10",
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
                        href={assetContentUrl(projectId, asset.id)}
                        title={labels.download}
                      >
                        <Download aria-hidden className="size-3.5" />
                      </a>
                    </div>

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
                      {selected ? (
                        <Check aria-hidden className="size-3.5" />
                      ) : null}
                    </button>

                    <figcaption className="space-y-1 px-2 py-2">
                      {/* The prompt is the caption, as in any place people scroll
                      through their own work; the rest is the provenance line. */}
                      <p
                        className="text-foreground line-clamp-1 text-xs"
                        title={asset.prompt}
                      >
                        {asset.prompt}
                      </p>
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

                      {/* What it cost to make, which is what a batch across
                      several models is read for. Both figures are measured:
                      the time is the provider's own submit-to-settle interval
                      and the credits are what the ledger debited. */}
                      {elapsed !== null || credits !== null ? (
                        <p
                          className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs tabular-nums"
                          title={provenance}
                        >
                          {elapsed !== null ? (
                            <span className="shrink-0">
                              <span className="sr-only">
                                {labels.generationTime}{" "}
                              </span>
                              {formatElapsed(elapsed)}
                            </span>
                          ) : null}
                          {credits !== null ? (
                            <span className="shrink-0">
                              <span className="sr-only">{labels.credits} </span>
                              {t("creditsCount", { count: credits })}
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                    </figcaption>
                  </figure>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <ul className={cn(GRID_CLASS, groups.length > 0 && "mt-6")}>
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

const GRID_CLASS = cn(
  "grid list-none grid-cols-2 gap-3 sm:grid-cols-3",
  "lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
);

const HOVER_ACTION_CLASS = cn(
  "bg-background text-foreground border-border flex size-7 items-center justify-center rounded-md border",
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
        // Each fill is paired with its own foreground token. --muted-foreground
        // is a page-side text role, so on --secondary — the inverse of the
        // page — it read as 44% grey on near-black in light mode and 72% grey
        // on white in dark: about 4:1 and about 2:1, and this word is 12px.
        tone === "approved"
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-secondary-foreground",
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
