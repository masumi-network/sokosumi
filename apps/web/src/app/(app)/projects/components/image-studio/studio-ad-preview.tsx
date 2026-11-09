import type { StudioLogoPosition } from "@sokosumi/core-client";
import {
  Bookmark,
  Ellipsis,
  Heart,
  MessageCircle,
  Send,
  Share2,
  ThumbsUp,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fetchStudioAd, saveStudioDownload } from "./studio-ad-download";
import { StudioImage } from "./studio-image";
import { StudioLogoPositionSelect } from "./studio-logo-position-select";
import { AD_PLACEMENTS, type PlacementRatio } from "./studio-placements";
import type { StudioAsset, StudioLabels } from "./types";

const PLATFORM_RATIOS = {
  instagram: ["1:1", "4:5"],
  facebook: ["1:1", "4:5", "16:9"],
  reels: ["9:16"],
} satisfies Record<string, [PlacementRatio, ...PlacementRatio[]]>;

type PreviewPlatform = keyof typeof PLATFORM_RATIOS;

export function StudioAdPreview({
  asset,
  caption,
  labels,
  projectLogo,
  logoPosition,
  onLogoPositionChange,
}: {
  asset: StudioAsset;
  caption?: string;
  labels: StudioLabels;
  projectLogo?: string | null;
  logoPosition?: StudioLogoPosition;
  onLogoPositionChange: (position: StudioLogoPosition | undefined) => void;
}) {
  const t = useTranslations("App.Studio");
  const [ratio, setRatio] = useState<PlacementRatio>(
    AD_PLACEMENTS.find(({ ratio }) => ratio === asset.settings?.aspectRatio)
      ?.ratio ?? "1:1",
  );
  const [platform, setPlatform] = useState<PreviewPlatform>(() =>
    ratio === "9:16" ? "reels" : ratio === "16:9" ? "facebook" : "instagram",
  );
  const [downloading, startDownload] = useTransition();
  const isReel = platform === "reels";
  const isFacebook = platform === "facebook";
  const platformRatios: readonly PlacementRatio[] = PLATFORM_RATIOS[platform];
  const platforms = Object.keys(PLATFORM_RATIOS) as PreviewPlatform[];
  const displayCaption = caption?.trim();
  const attribution = (
    <div className="flex min-w-0 items-center gap-2">
      <ProjectAvatar
        className="shrink-0 rounded-full"
        fallbackClassName="rounded-full"
        logo={projectLogo}
        name={asset.projectName ?? ""}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium break-words">{asset.projectName}</p>
        <p className="text-muted-foreground text-xs">{t("previewSponsored")}</p>
      </div>
    </div>
  );

  function selectPlatform(next: PreviewPlatform) {
    const allowed: [PlacementRatio, ...PlacementRatio[]] =
      PLATFORM_RATIOS[next];
    setPlatform(next);
    setRatio((current) => (allowed.includes(current) ? current : allowed[0]));
  }

  function downloadPlacement() {
    if (downloading) return;
    startDownload(async () => {
      try {
        const response = await fetchStudioAd(asset, {
          logo: logoPosition,
          placement: ratio,
        });
        const suffix = logoPosition ? "-branded" : "";
        saveStudioDownload(
          await response.blob(),
          `ad-v${asset.version}-${ratio.replace(":", "x")}${suffix}.png`,
        );
      } catch {
        toast.error(t("placementExportFailed"));
      }
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary">
          {t("previewAd")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="app-scrollbar max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{t("previewAd")}</DialogTitle>
          <DialogDescription>{t("previewAdDescription")}</DialogDescription>
        </DialogHeader>
        <div
          aria-label={t("previewPlatform")}
          className="flex flex-wrap gap-2"
          role="group"
        >
          {platforms.map((option) => (
            <Button
              aria-pressed={platform === option}
              key={option}
              onClick={() => selectPlatform(option)}
              size="sm"
              type="button"
              variant={platform === option ? "default" : "outline"}
            >
              {t(`PreviewPlatforms.${option}`)}
            </Button>
          ))}
        </div>
        {projectLogo ? (
          <StudioLogoPositionSelect
            label={t("logoOnCreative")}
            onChange={onLogoPositionChange}
            value={logoPosition}
          />
        ) : null}
        <div
          aria-label={t("adPlacements")}
          className="flex flex-wrap gap-2"
          role="group"
        >
          {AD_PLACEMENTS.filter(({ ratio }) =>
            platformRatios.includes(ratio),
          ).map(({ label, ratio: option }) => (
            <Button
              aria-pressed={ratio === option}
              key={option}
              onClick={() => setRatio(option)}
              size="sm"
              type="button"
              variant={ratio === option ? "default" : "outline"}
            >
              {t(`Placements.${label}`)} · {option}
            </Button>
          ))}
        </div>
        <div
          aria-label={t(`PreviewPlatforms.${platform}`)}
          className={cn(
            "bg-card-background border-border relative mx-auto max-w-full min-w-0 overflow-hidden rounded-xl border",
            isReel ? "w-52" : "w-80",
          )}
          role="group"
        >
          {!isReel ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              {attribution}
              <Ellipsis
                aria-hidden
                className="text-muted-foreground size-4 shrink-0"
              />
            </div>
          ) : null}
          {isFacebook && displayCaption ? (
            <p className="px-3 pb-2 text-sm break-words whitespace-pre-wrap">
              {displayCaption}
            </p>
          ) : null}
          <div
            className="bg-muted"
            style={{ aspectRatio: ratio.replace(":", " / ") }}
          >
            <StudioImage
              asset={asset}
              key={`${ratio}:${logoPosition ?? "original"}`}
              labels={labels}
              logoPosition={logoPosition}
              placement={ratio}
            />
          </div>
          {isReel ? (
            <>
              <div
                aria-hidden
                className="bg-background absolute right-2 bottom-20 flex flex-col gap-3 rounded-md p-2"
              >
                <Heart className="size-4" />
                <MessageCircle className="size-4" />
                <Send className="size-4" />
              </div>
              <div className="bg-background absolute inset-x-0 bottom-0 space-y-1 px-3 py-2">
                {attribution}
                {displayCaption ? (
                  <p className="line-clamp-2 text-xs break-words">
                    {displayCaption}
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div
                aria-hidden
                className={cn(
                  "text-muted-foreground flex items-center gap-3 px-3 py-2 [&_svg]:size-4",
                  isFacebook && "border-border justify-around border-t",
                )}
              >
                {isFacebook ? <ThumbsUp /> : <Heart />}
                <MessageCircle />
                {isFacebook ? <Share2 /> : <Send />}
                {!isFacebook ? <Bookmark className="ml-auto" /> : null}
              </div>
              {!isFacebook && displayCaption ? (
                <p className="px-3 pb-2 text-sm break-words whitespace-pre-wrap">
                  {displayCaption}
                </p>
              ) : null}
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            loading={downloading}
            onClick={downloadPlacement}
            type="button"
          >
            {t("downloadPlacementPng", { ratio })}
          </Button>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {labels.close}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
