"use client";

import { Check, Loader2, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import {
  assetContentUrl,
  type StudioAsset,
  type StudioJob,
  type StudioLabels,
} from "./types";

/**
 * The version rail.
 *
 * Every tile is a real button with `aria-pressed`, and review state is carried
 * by an icon plus a text label — never by colour alone.
 */
export function StudioHistory({
  assets,
  activeJobs,
  labels,
  onSelect,
  projectId,
  selectedAssetId,
}: {
  assets: StudioAsset[];
  activeJobs: StudioJob[];
  labels: StudioLabels;
  onSelect: (assetId: string) => void;
  projectId: string;
  selectedAssetId: string | null;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the chosen tile on screen when selection moves by keyboard or when a
  // result arrives. Scrolling a DOM node is external sync, so an Effect fits.
  useEffect(() => {
    if (!selectedAssetId) return;
    listRef.current
      ?.querySelector(`[data-asset-id="${CSS.escape(selectedAssetId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedAssetId]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const index = assets.findIndex((asset) => asset.id === selectedAssetId);
    if (index === -1) return;
    const next = event.key === "ArrowLeft" ? index - 1 : index + 1;
    const target = assets[next];
    if (!target) return;
    event.preventDefault();
    onSelect(target.id);
  }

  return (
    <section aria-label={labels.history} className="min-w-0">
      <h2 className="text-muted-foreground mb-2 text-xs font-medium">
        {labels.history}
      </h2>
      <div
        className="flex gap-3 overflow-x-auto pb-2"
        onKeyDown={handleKeyDown}
        ref={listRef}
      >
        {activeJobs.map((job) => (
          <div
            className="border-border bg-card-background flex size-24 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed"
            key={job.id}
          >
            <Loader2
              className="text-muted-foreground size-4 animate-spin"
              aria-hidden
            />
            <span className="text-muted-foreground text-[11px]">
              {job.status === "QUEUED" || job.status === "PENDING"
                ? labels.queued
                : labels.generating}
            </span>
          </div>
        ))}
        {assets.map((asset) => {
          const isSelected = asset.id === selectedAssetId;
          const decision = asset.review?.decision ?? null;
          return (
            <button
              aria-label={`${labels.version} ${asset.version} — ${
                decision === "APPROVED"
                  ? labels.approved
                  : decision === "REJECTED"
                    ? labels.rejected
                    : labels.undecided
              }`}
              aria-pressed={isSelected}
              className={cn(
                "group relative size-24 shrink-0 overflow-hidden rounded-lg border transition-colors outline-none",
                "focus-visible:ring-ring-halo focus-visible:ring-[3px]",
                isSelected
                  ? "border-primary ring-primary/30 ring-2"
                  : "border-border hover:border-primary-tertiary",
              )}
              data-asset-id={asset.id}
              key={asset.id}
              onClick={() => onSelect(asset.id)}
              type="button"
            >
              <img
                alt=""
                className="size-full object-cover"
                loading="lazy"
                src={assetContentUrl(projectId, asset.id)}
              />
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-1.5 py-1 text-[10px] font-medium text-white">
                <span>v{asset.version}</span>
                {decision === "APPROVED" ? (
                  <span className="flex items-center gap-0.5">
                    <Check className="size-3" aria-hidden />
                    {labels.approved}
                  </span>
                ) : decision === "REJECTED" ? (
                  <span className="flex items-center gap-0.5">
                    <X className="size-3" aria-hidden />
                    {labels.rejected}
                  </span>
                ) : (
                  <span>{labels.undecided}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
