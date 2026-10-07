import type { SocialPostMediaRef } from "@sokosumi/core-client";
import { Fragment } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

/** The connected account a preview renders as its author. */
export interface SocialPostPreviewAccount {
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface SocialPostPreviewContentProps {
  account: SocialPostPreviewAccount | null;
  media: SocialPostMediaRef[];
  text: string;
  /** Publish time; null reads as "now" (a draft or a post going out now). */
  timestamp: Date | null;
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

const TOKEN_PATTERN = /(https?:\/\/[^\s]+|#[\p{L}\p{N}_]+|@[\p{L}\p{N}_.]+)/gu;
const URL_DISPLAY_MAX = 25;

/** Links show without their scheme and shortened, the way X and LinkedIn do. */
function displayUrl(url: string): string {
  const bare = url.replace(/^https?:\/\/(www\.)?/, "");
  return bare.length > URL_DISPLAY_MAX
    ? `${bare.slice(0, URL_DISPLAY_MAX - 1)}…`
    : bare;
}

/** Post text with links, hashtags and mentions in the platform's link color. */
export function PreviewRichText({
  text,
  linkClassName,
}: {
  text: string;
  linkClassName: string;
}) {
  const parts = text.split(TOKEN_PATTERN);
  return parts.map((part, index) => {
    // split() with one capture group puts matches at odd indexes.
    if (index % 2 === 0) {
      return <Fragment key={index}>{part}</Fragment>;
    }
    return (
      <span key={index} className={linkClassName}>
        {part.startsWith("http") ? displayUrl(part) : part}
      </span>
    );
  });
}

export function PreviewMediaItem({
  media,
  className,
}: {
  media: SocialPostMediaRef;
  className?: string;
}) {
  const mediaClassName = cn("size-full object-cover", className);
  if (media.kind === "video") {
    return (
      <video
        aria-label={media.name}
        className={mediaClassName}
        muted
        playsInline
        preload="metadata"
        src={media.fileUrl}
      />
    );
  }
  return (
    <img
      alt={media.name}
      className={mediaClassName}
      decoding="async"
      loading="lazy"
      src={media.fileUrl}
    />
  );
}

/**
 * X and Facebook lay out up to four images the same way: one fills the frame,
 * two split it, three put the first on the left, four make a 2×2 grid.
 */
export function PreviewMediaGrid({
  media,
  className,
}: {
  media: SocialPostMediaRef[];
  className?: string;
}) {
  if (media.length === 0) return null;
  const [first, ...rest] = media;
  if (media.length === 1 && first) {
    return (
      <div className={cn("overflow-hidden", className)}>
        <PreviewMediaItem media={first} className="max-h-[32rem]" />
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
          <PreviewMediaItem media={first} />
        </div>
      ) : null}
      {rest.slice(0, 3).map((item) => (
        <div key={item.pathname} className="min-h-0">
          <PreviewMediaItem media={item} />
        </div>
      ))}
    </div>
  );
}
