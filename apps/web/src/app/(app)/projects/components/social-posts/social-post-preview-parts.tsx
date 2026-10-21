import type {
  SocialAccountPostMedia,
  SocialPostMediaRef,
} from "@sokosumi/core-client";
import { Play } from "lucide-react";
import { Fragment } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

/** Imported media stays provider-hosted; draft media belongs to Drive. */
type PreviewMedia = SocialPostMediaRef | SocialAccountPostMedia;

/** The connected account a preview renders as its author. */
export interface SocialPostPreviewAccount {
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface SocialPostPreviewContentProps {
  account: SocialPostPreviewAccount | null;
  media: PreviewMedia[];
  text: string;
  /** Publish time; null reads as "now" (a draft or a post going out now). */
  timestamp: Date | null;
  /** Override the feed's time label, including an unknown publication date. */
  timestampLabel?: string;
  /** The provider did not return media for this imported post. */
  mediaUnavailable?: boolean;
  /**
   * Drafts grid: cap tall LinkedIn/Facebook/X media so a row of cards
   * stays even. Composer and the full preview keep the feed height.
   */
  compact?: boolean;
  /** Compact cards open the full preview instead of growing in the grid. */
  onSeeMore?: () => void;
}

export function accountName(
  account: SocialPostPreviewAccount | null,
  fallback: string,
): string {
  return account?.displayName ?? account?.handle?.replace(/^@/, "") ?? fallback;
}

export function accountHandle(
  account: SocialPostPreviewAccount | null,
): string | null {
  const handle = account?.handle;
  if (!handle) return null;
  return handle.startsWith("@") ? handle : `@${handle}`;
}

export function PreviewAvatar({
  account,
  name,
  className,
}: {
  account: SocialPostPreviewAccount | null;
  name: string;
  className?: string;
}) {
  return (
    <Avatar className={className}>
      <AvatarImage src={account?.avatarUrl ?? undefined} alt="" />
      <AvatarFallback className="text-xs font-semibold">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

const TOKEN_PATTERN =
  /(https?:\/\/[^\s]+|www\.[^\s]+|#[\p{L}\p{N}_]+|(?<![\p{L}\p{N}_])@[\p{L}\p{N}_.]+)/giu;
const TOKEN_PATTERN_WITH_CASHTAG =
  /(https?:\/\/[^\s]+|www\.[^\s]+|#[\p{L}\p{N}_]+|(?<![\p{L}\p{N}_])@[\p{L}\p{N}_.]+|(?<![\p{L}\p{N}])\$[A-Za-z]{1,6}(?:[._][A-Za-z]{1,2})?(?![A-Za-z0-9]))/giu;
const URL_DISPLAY_MAX = 25;

/** Links show without their scheme and shortened, the way X and LinkedIn do. */
function displayUrl(url: string): string {
  const bare = url.replace(/^(https?:\/\/)?(www\.)?/i, "");
  return bare.length > URL_DISPLAY_MAX
    ? `${bare.slice(0, URL_DISPLAY_MAX - 1)}…`
    : bare;
}

const URL_TRAILING_PUNCT = /[.,;:!?)>\]"'\u201d\u2019]+$/;

/** Post text with links, hashtags and mentions in the platform's link color. */
export function PreviewRichText({
  text,
  linkClassName,
  cashtags = false,
}: {
  text: string;
  linkClassName: string;
  /** X colors $TICKER the way the live feed does. */
  cashtags?: boolean;
}) {
  const parts = text.split(
    cashtags ? TOKEN_PATTERN_WITH_CASHTAG : TOKEN_PATTERN,
  );
  return parts.map((part, index) => {
    // split() with one capture group puts matches at odd indexes.
    if (index % 2 === 0) {
      return <Fragment key={index}>{part}</Fragment>;
    }
    if (part.startsWith("@")) {
      const mention = part.replace(URL_TRAILING_PUNCT, "");
      const trail = part.slice(mention.length);
      return (
        <Fragment key={index}>
          <span className={linkClassName}>{mention}</span>
          {trail}
        </Fragment>
      );
    }
    if (/^www\./i.test(part) || /^https?:/i.test(part)) {
      const url = part.replace(URL_TRAILING_PUNCT, "");
      const trail = part.slice(url.length);
      return (
        <Fragment key={index}>
          <span className={linkClassName}>{displayUrl(url)}</span>
          {trail}
        </Fragment>
      );
    }
    return (
      <span key={index} className={linkClassName}>
        {part}
      </span>
    );
  });
}

export function PreviewMediaItem({
  media,
  className,
  showPlay = false,
}: {
  media: PreviewMedia;
  className?: string;
  /** Feed cards mark a video with a play badge; TikTok/YouTube draw their own. */
  showPlay?: boolean;
}) {
  const mediaClassName = cn("size-full object-cover", className);
  const src =
    "fileUrl" in media
      ? media.fileUrl
      : media.kind === "video"
        ? (media.thumbnailUrl ?? media.url)
        : media.url;
  const label = "name" in media ? media.name : media.kind;
  const visual =
    media.kind === "video" &&
    !("thumbnailUrl" in media && media.thumbnailUrl) ? (
      <video
        aria-label={label}
        className={mediaClassName}
        muted
        playsInline
        preload="metadata"
        src={src}
      />
    ) : (
      <img
        alt={label}
        className={mediaClassName}
        decoding="async"
        loading="lazy"
        src={src}
      />
    );
  if (media.kind === "video" && showPlay) {
    return (
      <div className="relative size-full min-h-0">
        {visual}
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-center"
          data-testid="social-post-preview-play"
        >
          <span className="bg-scrim-strong text-on-media flex size-10 items-center justify-center rounded-full">
            <Play className="size-4 fill-current" />
          </span>
        </div>
      </div>
    );
  }
  if (media.kind !== "gif") return visual;
  return (
    <div className="relative size-full min-h-0">
      {visual}
      <span
        aria-hidden
        className="bg-scrim-strong text-on-media absolute bottom-2 start-2 rounded px-1.5 py-0.5 text-2xs font-semibold"
        data-testid="social-post-preview-gif"
      >
        GIF
      </span>
    </div>
  );
}

/**
 * X and Facebook lay out up to four images the same way: one fills the frame,
 * two split it, three put the first on the left, four make a 2×2 grid.
 */
export function PreviewMediaGrid({
  media,
  className,
  compact = false,
}: {
  media: PreviewMedia[];
  className?: string;
  compact?: boolean;
}) {
  if (media.length === 0) return null;
  const [first, ...rest] = media;
  if (media.length === 1 && first) {
    return (
      <div
        className={cn("overflow-hidden", compact && "max-h-64", className)}
        data-testid={compact ? "social-post-preview-media-compact" : undefined}
      >
        <PreviewMediaItem
          media={first}
          showPlay
          className={
            compact
              ? "max-h-64 w-full object-cover object-top"
              : "max-h-[32rem]"
          }
        />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "grid aspect-video grid-cols-2 gap-0.5 overflow-hidden",
        media.length > 2 && "grid-rows-2",
        className,
      )}
      data-testid="social-post-preview-media-grid"
    >
      {first ? (
        <div className={cn("min-h-0", media.length === 3 && "row-span-2")}>
          <PreviewMediaItem media={first} showPlay />
        </div>
      ) : null}
      {rest.slice(0, 3).map((item) => (
        <div
          key={"pathname" in item ? item.pathname : item.url}
          className="min-h-0"
        >
          <PreviewMediaItem media={item} showPlay />
        </div>
      ))}
    </div>
  );
}
