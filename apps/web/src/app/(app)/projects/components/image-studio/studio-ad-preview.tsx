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
import { useRef, useState, useTransition } from "react";
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
import { readApprovedStudioHeadlines } from "./studio-approved-headlines";
import { useStudioHeadlineImage } from "./studio-headline-image";
import { StudioHeadlineSelect } from "./studio-headline-select";
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
  headline = "",
  onHeadlineChange,
  labels,
  projectLogo,
  logoPosition,
  onLogoPositionChange,
}: {
  asset: StudioAsset;
  caption?: string;
  headline?: string;
  onHeadlineChange?: (headline: string) => void;
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
  const [open, setOpen] = useState(false);
  const [headlines, setHeadlines] = useState<string[]>([]);
  const [headlineLoadFailed, setHeadlineLoadFailed] = useState(false);
  const [loadingHeadlines, startHeadlineLoad] = useTransition();
  const headlineRequest = useRef(0);
  const selectedHeadline =
    open && headlines.includes(headline) ? headline : undefined;
  const invalidHeadline = Boolean(headline && !selectedHeadline);
  const { result: headlineImage, retry: retryHeadline } =
    useStudioHeadlineImage(asset, ratio, logoPosition, selectedHeadline);
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

  function loadHeadlines() {
    const request = ++headlineRequest.current;
    setHeadlineLoadFailed(false);
    startHeadlineLoad(async () => {
      try {
        const options = await readApprovedStudioHeadlines(asset.projectId);
        if (request === headlineRequest.current) setHeadlines(options);
      } catch {
        if (request === headlineRequest.current) setHeadlineLoadFailed(true);
      }
    });
  }

  function downloadPlacement() {
    if (downloading || invalidHeadline) return;
    startDownload(async () => {
      try {
        if (selectedHeadline) {
          if (headlineImage?.status !== "ready") return;
          const options = await readApprovedStudioHeadlines(asset.projectId);
          if (!options.includes(selectedHeadline)) {
            setHeadlines(options);
            toast.error(t("headlineRemoved"));
            return;
          }
        }
        const blob =
          headlineImage?.status === "ready"
            ? headlineImage.blob
            : await fetchStudioAd(asset, {
                logo: logoPosition,
                placement: ratio,
              }).then((response) => response.blob());
        const suffix =
          (logoPosition ? "-branded" : "") +
          (selectedHeadline ? "-headline" : "");
        saveStudioDownload(
          blob,
          `ad-v${asset.version}-${ratio.replace(":", "x")}${suffix}.png`,
        );
      } catch {
        toast.error(t("placementExportFailed"));
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setHeadlines([]);
          loadHeadlines();
        }
      }}
    >
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
        {loadingHeadlines ? (
          <p className="text-muted-foreground text-xs" role="status">
            {t("headlineLoading")}
          </p>
        ) : headlineLoadFailed ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-muted-foreground text-xs" role="status">
              {t("headlineLoadFailed")}
            </p>
            <Button
              onClick={loadHeadlines}
              size="sm"
              type="button"
              variant="ghost"
            >
              {labels.imageRetry}
            </Button>
          </div>
        ) : onHeadlineChange && (headlines.length || headline) ? (
          <div className="min-w-0 space-y-1">
            <StudioHeadlineSelect
              disabled={downloading}
              headline={headline}
              onChange={onHeadlineChange}
              options={headlines}
            />
            <p className="text-muted-foreground text-xs">{t("headlineHint")}</p>
          </div>
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
            {selectedHeadline ? (
              headlineImage?.status === "ready" ? (
                <img
                  alt={`${asset.prompt} — ${selectedHeadline}`}
                  className="size-full object-cover"
                  src={headlineImage.url}
                />
              ) : (
                <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-xs">
                  <p role="status">
                    {t(
                      headlineImage?.status === "error"
                        ? "headlineRenderFailed"
                        : "headlineRendering",
                    )}
                  </p>
                  {headlineImage?.status === "error" ? (
                    <Button
                      onClick={retryHeadline}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {labels.imageRetry}
                    </Button>
                  ) : null}
                </div>
              )
            ) : (
              <StudioImage
                asset={asset}
                key={`${ratio}:${logoPosition ?? "original"}`}
                labels={labels}
                logoPosition={logoPosition}
                placement={ratio}
              />
            )}
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
            disabled={Boolean(
              invalidHeadline ||
                (selectedHeadline && headlineImage?.status !== "ready"),
            )}
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
