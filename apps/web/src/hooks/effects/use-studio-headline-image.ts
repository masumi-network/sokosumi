"use client";

import type { StudioLogoPosition } from "@sokosumi/core-client";
import { useEffect, useState } from "react";

import { fetchStudioAd } from "@/app/projects/components/image-studio/studio-ad-download";
import {
  renderStudioHeadline,
  type StudioHeadlineLook,
} from "@/app/projects/components/image-studio/studio-ad-headline";
import { usesExactFontOverlay } from "@/app/projects/components/image-studio/studio-lettering";
import type { PlacementRatio } from "@/app/projects/components/image-studio/studio-placements";
import type {
  StudioAsset,
  StudioJob,
} from "@/app/projects/components/image-studio/types";

type RenderedHeadline =
  | { key: string; status: "ready"; blob: Blob; url: string }
  | { key: string; status: "error" };

export function useStudioHeadlineImage(
  asset: Pick<StudioAsset, "id" | "projectId" | "lettering">,
  placement: PlacementRatio,
  logo: StudioLogoPosition | undefined,
  headline: string | undefined,
  jobs: readonly Pick<
    StudioJob,
    "parentAssetId" | "lettering" | "status"
  >[] = [],
  look?: StudioHeadlineLook,
) {
  const { id, projectId } = asset;
  const overlayHeadline = usesExactFontOverlay(asset, jobs)
    ? headline
    : undefined;
  const [result, setResult] = useState<RenderedHeadline | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([
    id,
    projectId,
    placement,
    logo,
    overlayHeadline,
    look,
    attempt,
  ]);
  const [previousKey, setPreviousKey] = useState(key);
  if (previousKey !== key) {
    setPreviousKey(key);
    setResult(null);
  }
  useEffect(() => {
    if (!overlayHeadline) return;
    const request = new AbortController();
    let url: string | undefined;

    async function render(text: string) {
      try {
        const response = await fetchStudioAd(
          { id, projectId },
          { placement, logo },
          request.signal,
        );
        const blob = await renderStudioHeadline(
          await response.blob(),
          text,
          logo,
          look,
        );
        if (request.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setResult({ key, status: "ready", blob, url });
      } catch {
        if (!request.signal.aborted) setResult({ key, status: "error" });
      }
    }
    void render(overlayHeadline);
    return () => {
      request.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [overlayHeadline, id, key, logo, placement, projectId, look]);

  return {
    result: overlayHeadline && result?.key === key ? result : null,
    retry: () => setAttempt((value) => value + 1),
  };
}
