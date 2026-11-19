"use client";

import type { ProjectImageJob } from "@sokosumi/core-client";
import { LoaderCircle, Plus, VideoOff } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { assetContentUrl } from "@/app/projects/components/image-studio/types";
import { Button } from "@/components/ui/button";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

import {
  ACTIVE_STATUSES,
  ElapsedTime,
  type Playback,
  type TalkingVideoAsset,
} from "./tiktok-studio-stage";

/**
 * Every video of the project in one row, each with its state; choosing one
 * shows it on the stage. It leads the page, so a returning owner sees what
 * they made before the form for a new one.
 */
export function TikTokStudioLibrary({
  jobs,
  assetFor,
  playbackFor,
  selectedId,
  onSelect,
  onNew,
}: {
  jobs: ProjectImageJob[];
  assetFor: (job: ProjectImageJob) => TalkingVideoAsset | null;
  /** What the stage player found; it outranks a thumbnail's own load. */
  playbackFor: (asset: TalkingVideoAsset) => Playback;
  selectedId: string | null;
  onSelect: (job: ProjectImageJob) => void;
  /** Leads to the form; none when the project is changed elsewhere. */
  onNew?: () => void;
}) {
  const t = useTranslations("App.TikTokStudio");
  const format = useFormatter();
  return (
    <section aria-label={t("videos")} className={cn(HOLDER_CLASS, "min-w-0")}>
      <div className="flex min-h-8 items-center justify-between gap-2 px-2 pb-2">
        <h2 className="flex items-baseline gap-2 text-sm font-medium">
          {t("videos")}
          <span className="text-muted-foreground text-xs tabular-nums">
            {format.number(jobs.length)}
          </span>
        </h2>
        {onNew ? (
          <Button onClick={onNew} size="sm" variant="outline">
            <Plus aria-hidden />
            {t("newVideo")}
          </Button>
        ) : null}
      </div>
      <ul className="flex gap-2 overflow-x-auto p-0.5">
        {jobs.map((job) => {
          const asset = assetFor(job);
          return (
            <li className="w-22 shrink-0" key={job.id}>
              <LibraryTile
                asset={asset}
                job={job}
                onSelect={() => onSelect(job)}
                playback={asset ? playbackFor(asset) : undefined}
                selected={job.id === selectedId}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** One video in the row: its thumbnail, its state and its script. */
function LibraryTile({
  job,
  asset,
  playback,
  selected,
  onSelect,
}: {
  job: ProjectImageJob;
  asset: TalkingVideoAsset | null;
  playback: Playback;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("App.TikTokStudio");
  /** The thumbnail's own load failed; it never changes the stage. */
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  // A fast 404 can land before hydration, when no error handler listens yet.
  const checkLoaded = useCallback((video: HTMLVideoElement | null) => {
    if (video?.error) setThumbnailFailed(true);
  }, []);
  const making = ACTIVE_STATUSES.has(job.status);
  const unavailable =
    asset !== null &&
    (playback === "failed" || (thumbnailFailed && playback !== "ready"));

  return (
    <button
      aria-pressed={selected}
      className="group press flex w-full min-w-0 flex-col gap-1 rounded-lg text-start"
      onClick={onSelect}
      type="button"
    >
      <span
        className={cn(
          "bg-background relative flex aspect-9/16 w-full items-center justify-center overflow-hidden rounded-lg border-2",
          selected ? "border-foreground" : "border-transparent",
        )}
      >
        {unavailable ? (
          <VideoOff aria-hidden className="text-muted-foreground size-5" />
        ) : asset ? (
          <video
            aria-hidden
            className="pointer-events-none absolute inset-0 size-full object-cover"
            muted
            onError={() => setThumbnailFailed(true)}
            playsInline
            preload="metadata"
            ref={checkLoaded}
            src={assetContentUrl(asset)}
            tabIndex={-1}
          />
        ) : making ? (
          <LoaderCircle
            aria-hidden
            className="text-muted-foreground size-5 motion-safe:animate-spin"
          />
        ) : null}
      </span>
      <span className="text-xs font-medium tabular-nums">
        {asset ? (
          unavailable ? (
            t("videoUnavailable")
          ) : (
            t("videoReady")
          )
        ) : making ? (
          <>
            {t("videoMaking")}
            {" · "}
            <ElapsedTime since={new Date(job.createdAt)} />
          </>
        ) : (
          t("videoFailed")
        )}
      </span>
      <span className="text-muted-foreground group-hover:text-foreground line-clamp-2 text-xs transition-colors">
        {job.prompt}
      </span>
    </button>
  );
}
