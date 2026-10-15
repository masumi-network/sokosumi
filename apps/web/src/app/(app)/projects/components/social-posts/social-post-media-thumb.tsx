import type { SocialPostMediaRef } from "@sokosumi/core-client";
import { Play } from "lucide-react";
import { FileChipMiniPreview } from "@/components/ui/file-chip-mini-preview";

/**
 * Compact row thumbnail. Images and GIFs reuse the shared mini preview;
 * video shows its first frame in the same 48px frame, with the calendar
 * play mark so it does not read as a still.
 */
export function SocialPostMediaThumb({ media }: { media: SocialPostMediaRef }) {
  if (media.kind !== "video") {
    const preview = (
      <FileChipMiniPreview
        fileName={media.name}
        mediaType={media.mimeType}
        size={media.size}
        sizeClass="size-12"
        url={media.fileUrl}
      />
    );
    if (media.kind !== "gif") return preview;
    return (
      <span className="relative inline-flex">
        {preview}
        <span
          aria-hidden
          className="bg-scrim-strong text-on-media pointer-events-none absolute start-1 bottom-1 rounded px-1 py-0.5 text-2xs font-semibold"
          data-testid="social-post-media-gif"
        >
          GIF
        </span>
      </span>
    );
  }

  return (
    <a
      aria-label={media.name}
      className="bg-card-background press hover:bg-card-background-hover focus-visible:ring-ring focus-visible:ring-2 relative block size-12 shrink-0 overflow-hidden rounded-xl border outline-none transition-[color,background-color,border-color,transform]"
      href={media.fileUrl}
      rel="noreferrer noopener"
      target="_blank"
    >
      <video
        className="size-full object-cover"
        muted
        playsInline
        preload="metadata"
        src={media.fileUrl}
      />
      <span
        aria-hidden
        className="bg-background text-foreground pointer-events-none absolute inset-0 m-auto flex size-5 items-center justify-center rounded-full"
        data-testid="social-post-media-video-play"
      >
        <Play className="size-2.5 fill-current" />
      </span>
    </a>
  );
}
