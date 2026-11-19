"use client";

import type {
  ProjectImageJob,
  ProjectTalkingVideos,
} from "@sokosumi/core-client";
import { Download, RotateCcw, Send, VideoOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";

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
/**
 * What the stage player found for a finished video's file: it plays, it
 * failed, or it is being tried again after a failure. Unknown until then.
 */
export type Playback = "ready" | "failed" | "retrying" | undefined;

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
        <p className="bg-scrim text-on-media absolute inset-x-4 bottom-1/3 rounded-md px-3 py-2 text-center text-sm font-semibold">
          <span className="line-clamp-3">
            {script || t("captionPlaceholder")}
          </span>
        </p>
      )}
    </Frame>
  );
}

/** Seconds since a moment, ticking each second once mounted on the client. */
function useElapsedSeconds(since: Date): number | null {
  const [now, setNow] = useState<number | null>(null);
  useMountEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  });
  return now === null
    ? null
    : Math.max(0, Math.floor((now - since.getTime()) / 1000));
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** How long a video has been in the making, as m:ss. */
export function ElapsedTime({ since }: { since: Date }) {
  const seconds = useElapsedSeconds(since);
  return seconds === null ? null : <>{clock(seconds)}</>;
}

function Elapsed({ since }: { since: Date }) {
  const t = useTranslations("App.TikTokStudio");
  const seconds = useElapsedSeconds(since);
  if (seconds === null) return null;
  return (
    <>
      <span className="text-2xl font-light tabular-nums">{clock(seconds)}</span>
      <span className="text-on-media-muted text-xs">
        {seconds > SLOW_AFTER_SECONDS ? t("makingSlow") : t("makingHint")}
      </span>
    </>
  );
}

/** A finished video on the stage, or why its file does not play. */
function FinishedVideo({
  job,
  asset,
  playback,
  onPlayback,
  posting,
  onPost,
  postLabel,
}: {
  job: ProjectImageJob;
  asset: TalkingVideoAsset;
  playback: Playback;
  onPlayback: (playback: Playback) => void;
  posting: boolean;
  postLabel: string;
  onPost?: (asset: TalkingVideoAsset) => void;
}) {
  const t = useTranslations("App.TikTokStudio");
  const player = useRef<HTMLDivElement>(null);
  /** This stage tried the file again, so a new failure takes focus. */
  const [retried, setRetried] = useState(false);
  const focusOnMount = useCallback((button: HTMLButtonElement | null) => {
    button?.focus();
  }, []);

  // Off only once the file is known to fail, until a retry really plays.
  const blocked = playback === "failed" || playback === "retrying";
  const retry = () => {
    flushSync(() => {
      setRetried(true);
      onPlayback("retrying");
    });
    player.current?.focus();
  };
  return (
    <>
      <div
        className="focus-visible:ring-ring focus-visible:ring-offset-background rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        ref={player}
        tabIndex={-1}
      >
        {playback === "failed" ? (
          <Frame>
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-6 text-center"
              role="alert"
            >
              <VideoOff
                aria-hidden
                className="text-muted-foreground mb-2 size-6"
              />
              <span className="text-sm font-medium">{t("loadFailed")}</span>
              <span className="text-muted-foreground text-xs text-balance">
                {t("loadFailedBody")}
              </span>
              <Button
                className="mt-3"
                onClick={retry}
                ref={retried ? focusOnMount : undefined}
                size="sm"
              >
                <RotateCcw aria-hidden />
                {t("tryAgain")}
              </Button>
            </div>
          </Frame>
        ) : (
          <div className="bg-media-ground aspect-9/16 w-full overflow-hidden rounded-lg">
            <video
              aria-label={job.prompt}
              className="content-in size-full object-cover"
              controls
              key={asset.id}
              onCanPlay={() => onPlayback("ready")}
              onError={() => onPlayback("failed")}
              playsInline
              preload={playback === "retrying" ? "auto" : "metadata"}
              src={assetContentUrl(asset)}
            />
          </div>
        )}
      </div>
      {playback === "retrying" ? (
        <p className="text-muted-foreground px-1 text-xs" role="status">
          {t("checking")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {/* A file known to be missing downloads nothing. */}
        {!blocked ? (
          <Button asChild className="flex-1">
            <a download href={assetContentUrl(asset, { download: true })}>
              <Download aria-hidden />
              {t("download")}
            </a>
          </Button>
        ) : (
          <Button className="flex-1" disabled>
            <Download aria-hidden />
            {t("download")}
          </Button>
        )}
        {onPost ? (
          <Button
            className="flex-1"
            disabled={blocked}
            loading={posting}
            onClick={() => onPost(asset)}
          >
            <Send aria-hidden />
            {postLabel}
          </Button>
        ) : null}
      </div>
      <Badge className="self-start" title={t("aiLabelHint")} variant="outline">
        {t("aiLabel")}
      </Badge>
    </>
  );
}

/** One started video: being made, ready to watch, or not made. */
export function StageJob({
  job,
  asset,
  playback,
  onPlayback,
  image,
  posting,
  onPost,
  postLabel,
  onReuse,
}: {
  job: ProjectImageJob;
  asset: TalkingVideoAsset | null;
  playback: Playback;
  /** What this stage player found; only the stage reports it. */
  onPlayback: (playback: Playback) => void;
  /** The presenter's picture, shown while the video is made. */
  image?: string;
  posting: boolean;
  postLabel: string;
  onPost?: (asset: TalkingVideoAsset) => void;
  onReuse: () => void;
}) {
  const t = useTranslations("App.TikTokStudio");

  if (asset) {
    return (
      <FinishedVideo
        asset={asset}
        job={job}
        onPlayback={onPlayback}
        onPost={onPost}
        playback={playback}
        postLabel={postLabel}
        posting={posting}
      />
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
