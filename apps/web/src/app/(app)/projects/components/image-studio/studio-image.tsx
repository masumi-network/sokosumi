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
  /**
   * *Which* version failed to load, not merely that one did.
   *
   * A bare boolean outlives the asset it was about. The single-image lightbox
   * reuses this component as its arrows move between versions, so one missing
   * file marked every version stepped to afterwards as unavailable — the
   * fallback stayed on screen and no `img` was ever created for the next URL.
   * Keying the failure to an id makes the flag false again the moment a
   * different version is rendered, and correctly true again if you step back
   * to the broken one.
   */
  const [failedAssetId, setFailedAssetId] = useState<string | null>(null);
  const failed = failedAssetId === asset.id;

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
      onError={() => setFailedAssetId(asset.id)}
      src={assetContentUrl(projectId, asset.id)}
    />
  );
}
