"use client";

import type {
  ProjectImageJob,
  ProjectTalkingVideos,
} from "@sokosumi/core-client";
import { Download, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { assetContentUrl } from "@/app/projects/components/image-studio/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";

export const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "PENDING",
  "SUBMITTING",
  "QUEUED",
  "RUNNING",
]);
/** A video usually takes two minutes; past this it is called slow. */
const SLOW_AFTER_SECONDS = 300;

export type TalkingVideoAsset = ProjectTalkingVideos["assets"][number];

/** The 9:16 frame every state of a video is shown in. */
function Frame({ image, children }: { image?: string; children?: ReactNode }) {
  return (
    <div className="bg-background relative aspect-9/16 w-full overflow-hidden rounded-lg border">
      {image ? (
        <img alt="" className="size-full object-cover" src={image} />
      ) : null}
      {children}
    </div>
  );
}

/** The video as it will look: the presenter, with the script as captions. */
export function StagePreview({
  image,
  script,
  missingPhoto,
}: {
  image?: string;
  script: string;
  missingPhoto: boolean;
}) {
  const t = useTranslations("App.TikTokStudio");
  return (
    <Frame image={image}>
      <span className="bg-popover absolute start-2 top-2 rounded-md border px-2 py-0.5 text-xs font-medium">
        {t("preview")}
      </span>
      {missingPhoto ? (
        <p className="text-muted-foreground absolute inset-0 flex items-center justify-center p-6 text-center text-sm">
          {t("previewNoPhoto")}
        </p>
      ) : (
        <p className="bg-scrim text-on-media absolute inset-x-4 bottom-1/6 rounded-md px-3 py-2 text-center text-sm font-semibold">
          <span className="line-clamp-3">
            {script || t("captionPlaceholder")}
          </span>
        </p>
      )}
    </Frame>
  );
}

function Elapsed({ since }: { since: Date }) {
  const t = useTranslations("App.TikTokStudio");
  const [now, setNow] = useState<number | null>(null);
  useMountEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  });
  if (now === null) return null;
  const seconds = Math.max(0, Math.floor((now - since.getTime()) / 1000));
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <>
      <span className="text-2xl font-light tabular-nums">{time}</span>
      <span className="text-on-media-muted text-xs">
        {seconds > SLOW_AFTER_SECONDS ? t("makingSlow") : t("makingHint")}
      </span>
    </>
  );
}

/** One started video: being made, ready to watch, or not made. */
export function StageJob({
  job,
  asset,
  image,
  posting,
  onPost,
  onReuse,
}: {
  job: ProjectImageJob;
  asset: TalkingVideoAsset | null;
  /** The presenter's picture, shown while the video is made. */
  image?: string;
  posting: boolean;
  onPost: (asset: TalkingVideoAsset) => void;
  onReuse: () => void;
}) {
  const t = useTranslations("App.TikTokStudio");

  if (asset) {
    return (
      <>
        <div className="bg-media-ground aspect-9/16 w-full overflow-hidden rounded-lg">
          <video
            aria-label={job.prompt}
            className="content-in size-full object-cover"
            controls
            key={asset.id}
            playsInline
            preload="metadata"
            src={assetContentUrl(asset)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild className="flex-1">
            <a download href={assetContentUrl(asset, { download: true })}>
              <Download aria-hidden />
              {t("download")}
            </a>
          </Button>
          <Button
            className="flex-1"
            loading={posting}
            onClick={() => onPost(asset)}
          >
            <Send aria-hidden />
            {t("post")}
          </Button>
        </div>
        <Badge
          className="self-start"
          title={t("aiLabelHint")}
          variant="outline"
        >
          {t("aiLabel")}
        </Badge>
      </>
    );
  }

  if (ACTIVE_STATUSES.has(job.status)) {
    return (
      <Frame image={image}>
        <div className="bg-scrim text-on-media absolute inset-0 flex flex-col items-center justify-center gap-1 p-6 text-center">
          <span className="text-sm font-medium" role="status">
            {job.status === "RUNNING" ? t("making") : t("starting")}
          </span>
          <Elapsed since={new Date(job.createdAt)} />
        </div>
        <span
          aria-hidden
          className="animate-button-loading-sweep border-on-media absolute bottom-0 left-0 h-0 w-2/5 border-t-2 motion-reduce:w-full motion-reduce:animate-pulse"
        />
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-6 text-center">
        <span className="text-sm font-medium">{t("failed")}</span>
        <span className="text-muted-foreground text-xs">{t("failedBody")}</span>
        <Button className="mt-3" onClick={onReuse} size="sm">
          {t("reuseScript")}
        </Button>
      </div>
    </Frame>
  );
}
