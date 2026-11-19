"use client";

import type { ProjectImageJob } from "@sokosumi/core-client";
import { LoaderCircle, Plus, VideoOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { assetContentUrl } from "@/app/projects/components/image-studio/types";
import { Button } from "@/components/ui/button";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

import {
  ACTIVE_STATUSES,
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
  onPlayback,
  selectedId,
  onSelect,
  onNew,
}: {
  jobs: ProjectImageJob[];
  assetFor: (job: ProjectImageJob) => TalkingVideoAsset | null;
  playbackFor: (asset: TalkingVideoAsset) => Playback;
  onPlayback: (asset: TalkingVideoAsset, playback: Playback) => void;
  selectedId: string | null;
  onSelect: (job: ProjectImageJob) => void;
  /** Leads to the form; none when the project is changed elsewhere. */
  onNew?: () => void;
}) {
  const t = useTranslations("App.TikTokStudio");
  return (
    <section aria-label={t("videos")} className={cn(HOLDER_CLASS, "min-w-0")}>
      <div className="flex min-h-8 items-center justify-between gap-2 px-2 pb-2">
        <h2 className="flex items-baseline gap-2 text-sm font-medium">
          {t("videos")}
          <span className="text-muted-foreground text-xs tabular-nums">
            {jobs.length}
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
          const unavailable = asset !== null && playbackFor(asset) === "failed";
          const selected = job.id === selectedId;
          return (
            <li className="w-22 shrink-0" key={job.id}>
              <button
                aria-pressed={selected}
                className="group press flex w-full min-w-0 flex-col gap-1 rounded-lg text-start"
                onClick={() => onSelect(job)}
                type="button"
              >
                <span
                  className={cn(
                    "bg-background relative flex aspect-9/16 w-full items-center justify-center overflow-hidden rounded-lg border-2",
                    selected ? "border-foreground" : "border-transparent",
                  )}
                >
                  {unavailable ? (
                    <VideoOff
                      aria-hidden
                      className="text-muted-foreground size-5"
                    />
                  ) : asset ? (
                    <video
                      aria-hidden
                      className="pointer-events-none absolute inset-0 size-full object-cover"
                      muted
                      onError={() => onPlayback(asset, "failed")}
                      onLoadedMetadata={() => onPlayback(asset, "ready")}
                      playsInline
                      preload="metadata"
                      src={assetContentUrl(asset)}
                      tabIndex={-1}
                    />
                  ) : ACTIVE_STATUSES.has(job.status) ? (
                    <LoaderCircle
                      aria-hidden
                      className="text-muted-foreground size-5 motion-safe:animate-spin"
                    />
                  ) : null}
                </span>
                <span className="text-xs font-medium">
                  {asset
                    ? unavailable
                      ? t("videoUnavailable")
                      : t("videoReady")
                    : ACTIVE_STATUSES.has(job.status)
                      ? t("videoMaking")
                      : t("videoFailed")}
                </span>
                <span className="text-muted-foreground group-hover:text-foreground line-clamp-2 text-xs transition-colors">
                  {job.prompt}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
