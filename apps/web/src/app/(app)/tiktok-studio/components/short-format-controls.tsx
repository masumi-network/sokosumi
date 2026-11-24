"use client";

import type {
  CreateProjectShortVideoJobRequest,
  ProjectImageAsset,
} from "@sokosumi/core-client";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { RadioGroup } from "radix-ui";

import { assetContentUrl } from "@/app/projects/components/image-studio/types";
import { usePrefersReducedMotion } from "@/hooks/effects/use-media-query";
import { cn } from "@/lib/utils";

export type ShortFormat = CreateProjectShortVideoJobRequest["format"];
/** What the studio makes: a presenter speaking, or a short in a format. */
export type VideoKind = "presenter" | ShortFormat;

/** The order the formats are offered in: the most useful first. */
export const SHORT_FORMATS = [
  "voiceover",
  "site_tour",
  "top_three",
  "slideshow",
] as const satisfies readonly ShortFormat[];

/** A slideshow's words are on screen; the other formats are spoken. */
export function shortFormatSpeaks(kind: VideoKind): boolean {
  return kind !== "slideshow";
}

const SAMPLE_BASE = "/studio/short-formats";

/**
 * The kind of video to make, each with what it is and a real example: a
 * short made with the studio for a sample brand.
 */
export function VideoKindPicker({
  value,
  presenterImage,
  hasWebsite,
  readOnly,
  onChange,
}: {
  value: VideoKind;
  presenterImage?: string;
  hasWebsite: boolean;
  readOnly: boolean;
  onChange: (kind: VideoKind) => void;
}) {
  const t = useTranslations("App.TikTokStudio");
  const reducedMotion = usePrefersReducedMotion();
  const kinds: VideoKind[] = ["presenter", ...SHORT_FORMATS];
  return (
    <RadioGroup.Root
      aria-label={t("kind")}
      // One row whenever the form has the width; lg keeps 3 because the
      // preview column sits beside the form there.
      className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-5"
      disabled={readOnly}
      onValueChange={(next) => onChange(next as VideoKind)}
      value={value}
    >
      {kinds.map((kind) => {
        const needsSite = kind === "site_tour" && !hasWebsite;
        const selected = value === kind;
        return (
          <RadioGroup.Item
            className={cn(
              "press border-control-border flex min-w-0 flex-col gap-2 rounded-lg border p-2 text-start transition-colors duration-150",
              selected ? "border-foreground" : "hover:bg-accent",
              needsSite && "opacity-60",
            )}
            disabled={needsSite}
            key={kind}
            value={kind}
          >
            <span className="bg-muted relative aspect-square w-full overflow-hidden rounded-md sm:aspect-9/16">
              {kind === "presenter" ? (
                presenterImage ? (
                  <img
                    alt=""
                    className="size-full object-cover max-sm:object-top"
                    loading="lazy"
                    src={presenterImage}
                  />
                ) : null
              ) : (
                <video
                  aria-hidden
                  autoPlay={selected && !reducedMotion}
                  className="size-full object-cover max-sm:object-top"
                  // Only the chosen kind plays; the rest show their poster.
                  key={selected && !reducedMotion ? "playing" : "still"}
                  loop
                  muted
                  playsInline
                  poster={`${SAMPLE_BASE}/${kind}.jpg`}
                  preload="none"
                  src={`${SAMPLE_BASE}/${kind}.mp4`}
                  tabIndex={-1}
                />
              )}
              {selected ? (
                <span className="bg-foreground text-background absolute end-1.5 top-1.5 flex size-5 items-center justify-center rounded-full">
                  <Check aria-hidden className="size-3" />
                </span>
              ) : null}
            </span>
            <span className="flex flex-col gap-0.5 px-0.5">
              <span className="text-sm font-medium">{t(`kinds.${kind}`)}</span>
              <span className="text-muted-foreground text-xs">
                {needsSite ? t("kindNeedsSite") : t(`kindHints.${kind}`)}
              </span>
            </span>
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}

/**
 * The Project's pictures a short can show, chosen in the order they play.
 * The number on a chosen picture is its place in the video.
 */
export function ShortPictures({
  pictures,
  chosen,
  max,
  readOnly,
  onChange,
}: {
  pictures: ProjectImageAsset[];
  chosen: string[];
  max: number;
  readOnly: boolean;
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations("App.TikTokStudio");
  if (pictures.length === 0)
    return <p className="text-muted-foreground text-sm">{t("noPictures")}</p>;
  const full = chosen.length >= max;
  return (
    <ul
      aria-label={t("pictures")}
      className="grid grid-cols-4 gap-2 sm:grid-cols-6"
    >
      {pictures.map((picture) => {
        const place = chosen.indexOf(picture.id);
        const isChosen = place >= 0;
        return (
          <li key={picture.id}>
            <button
              aria-pressed={isChosen}
              aria-label={
                isChosen
                  ? t("pictureChosen", { place: place + 1 })
                  : t("pictureChoose")
              }
              className={cn(
                "press bg-muted relative block aspect-9/16 w-full overflow-hidden rounded-lg border-2",
                isChosen ? "border-foreground" : "border-transparent",
              )}
              disabled={readOnly || (!isChosen && full)}
              onClick={() =>
                onChange(
                  isChosen
                    ? chosen.filter((id) => id !== picture.id)
                    : [...chosen, picture.id],
                )
              }
              type="button"
            >
              <img
                alt=""
                className="size-full object-cover"
                loading="lazy"
                src={assetContentUrl(picture)}
              />
              {isChosen ? (
                <span className="bg-foreground text-background text-2xs absolute end-1 top-1 flex size-5 items-center justify-center rounded-full font-medium tabular-nums">
                  {place + 1}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
