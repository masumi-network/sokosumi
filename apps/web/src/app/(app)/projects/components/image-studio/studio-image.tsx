"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { assetContentUrl, type StudioAsset } from "./types";

/**
 * A stored image, or an honest account of why it is not here.
 *
 * The bytes live in a private store behind an authorizing route, and that
 * route can legitimately answer 404: an object can be removed from the store
 * while its row survives. A broken-image glyph tells the person nothing and
 * looks like the product is broken; saying the version exists but its file is
 * gone is both true and actionable, because the prompt and settings beside it
 * are still there to generate from again.
 */
export function StudioImage({
  asset,
  className,
  fit = "cover",
  label,
  projectId,
}: {
  asset: StudioAsset;
  className?: string;
  fit?: "cover" | "contain";
  /** Shown in place of the picture when the bytes cannot be fetched. */
  label: string;
  projectId: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className={cn(
          "bg-muted text-muted-foreground flex size-full flex-col items-center justify-center gap-1.5 p-3 text-center",
          className,
        )}
      >
        <ImageOff aria-hidden className="size-4" />
        <span className="text-xs leading-snug">{label}</span>
      </span>
    );
  }

  return (
    <img
      alt={asset.prompt}
      className={cn(
        fit === "cover"
          ? "size-full object-cover"
          : "max-h-full max-w-full object-contain",
        className,
      )}
      loading="lazy"
      onError={() => setFailed(true)}
      src={assetContentUrl(projectId, asset.id)}
    />
  );
}
