"use client";

import type { ProjectImageJob } from "@sokosumi/core-client";
import { VIDEO_SHAPES, type VideoShape } from "@sokosumi/utils";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/** The frame's shape as a Tailwind aspect class. */
export const SHAPE_ASPECT: Record<VideoShape, string> = {
  "9:16": "aspect-9/16",
  "4:5": "aspect-4/5",
  "1:1": "aspect-square",
  "16:9": "aspect-video",
};

/** A small outline of the shape, 20 pixels on its long side. */
const SHAPE_ICON: Record<VideoShape, string> = {
  "9:16": "h-5 w-3",
  "4:5": "h-5 w-4",
  "1:1": "size-4",
  "16:9": "h-3 w-5",
};

export function shapeOf(job: ProjectImageJob): VideoShape {
  return job.talkingVideo?.shape ?? "9:16";
}

/** The first shape's job id: every shape of one video shares it. */
export function videoIdOf(job: ProjectImageJob): string {
  return job.talkingVideo?.sourceJobId ?? job.id;
}

/**
 * One job per video, in list order: its first shape, or, when that is on an
 * older page than its other shapes, the first of those.
 */
export function oneJobPerVideo(
  jobs: readonly ProjectImageJob[],
): ProjectImageJob[] {
  const listed = new Set(jobs.map((job) => job.id));
  const seen = new Set<string>();
  return jobs.filter((job) => {
    const videoId = videoIdOf(job);
    if (seen.has(videoId)) return false;
    if (job.id !== videoId && listed.has(videoId)) return false;
    seen.add(videoId);
    return true;
  });
}

/**
 * A video and the other shapes cut from it, in shape order. Shapes are their
 * own jobs, each pointing back at the first through `sourceJobId`.
 */
export function shapeFamily(
  jobs: readonly ProjectImageJob[],
  job: ProjectImageJob,
): ProjectImageJob[] {
  const videoId = videoIdOf(job);
  return jobs
    .filter((each) => videoIdOf(each) === videoId)
    .sort(
      (a, b) =>
        VIDEO_SHAPES.indexOf(shapeOf(a)) - VIDEO_SHAPES.indexOf(shapeOf(b)),
    );
}

/** Which shapes the video is made in: one or several, never none. */
export function ShapePicker({
  value,
  allowed,
  onChange,
  readOnly,
}: {
  value: readonly VideoShape[];
  /** The shapes this kind of video reads well in. */
  allowed: readonly VideoShape[];
  onChange: (shapes: VideoShape[]) => void;
  readOnly: boolean;
}) {
  const t = useTranslations("App.TikTokStudio.shapes");
  const toggle = (shape: VideoShape) => {
    const next = value.includes(shape)
      ? value.filter((each) => each !== shape)
      : [...value, shape];
    if (next.length > 0)
      onChange(VIDEO_SHAPES.filter((each) => next.includes(each)));
  };
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{t("label")}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {VIDEO_SHAPES.map((shape) => {
          const on = value.includes(shape);
          const possible = allowed.includes(shape);
          return (
            <button
              aria-pressed={on}
              className={cn(
                "press relative flex min-w-0 flex-col items-start gap-2 rounded-lg border p-3 text-start transition-colors duration-150",
                on
                  ? "border-foreground"
                  : "border-control-border hover:bg-accent",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
              disabled={readOnly || !possible || (on && value.length === 1)}
              key={shape}
              onClick={() => toggle(shape)}
              title={possible ? undefined : t("notForKind")}
              type="button"
            >
              <span aria-hidden className="flex h-5 items-center">
                <span
                  className={cn(
                    "border-foreground rounded-xs border-2",
                    SHAPE_ICON[shape],
                  )}
                />
              </span>
              <span className="text-sm font-medium">
                {t(`names.${shape}`)}{" "}
                <span className="text-muted-foreground font-normal tabular-nums">
                  {shape}
                </span>
              </span>
              <span className="text-muted-foreground text-xs">
                {t(`where.${shape}`)}
              </span>
              {on ? (
                <Check
                  aria-hidden
                  className="text-foreground absolute end-2 top-2 size-4"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">{t("hint")}</p>
    </fieldset>
  );
}

/** Switches between the shapes of one video, on the stage or its preview. */
export function ShapeTabs({
  shapes,
  value,
  onChange,
  label,
  making,
}: {
  shapes: readonly VideoShape[];
  value: VideoShape;
  onChange: (shape: VideoShape) => void;
  label: string;
  /** Shapes still being cut. */
  making?: ReadonlySet<VideoShape>;
}) {
  const t = useTranslations("App.TikTokStudio.shapes");
  if (shapes.length < 2) return null;
  return (
    <div
      aria-label={label}
      className="bg-quinary flex gap-1 rounded-lg p-1"
      role="tablist"
    >
      {shapes.map((shape) => (
        <button
          aria-selected={shape === value}
          className={cn(
            "flex-1 rounded-md border px-2 py-1 text-xs font-medium tabular-nums transition-colors duration-150",
            shape === value
              ? "bg-background text-foreground border-border"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
          key={shape}
          onClick={() => onChange(shape)}
          role="tab"
          title={t(`names.${shape}`)}
          type="button"
        >
          {shape}
          {making?.has(shape) ? (
            <span className="sr-only">{` ${t("making")}`}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
