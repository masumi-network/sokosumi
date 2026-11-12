import type { StudioLogoPosition } from "@sokosumi/core-client";
import { useEffect, useState } from "react";

import { fetchStudioAd } from "./studio-ad-download";
import { renderStudioHeadline } from "./studio-ad-headline";
import type { PlacementRatio } from "./studio-placements";
import type { StudioAsset } from "./types";

type RenderedHeadline =
  | { key: string; status: "ready"; blob: Blob; url: string }
  | { key: string; status: "error" };

export function useStudioHeadlineImage(
  { id, projectId }: Pick<StudioAsset, "id" | "projectId">,
  placement: PlacementRatio,
  logo: StudioLogoPosition | undefined,
  headline: string | undefined,
) {
  const [result, setResult] = useState<RenderedHeadline | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([
    id,
    projectId,
    placement,
    logo,
    headline,
    attempt,
  ]);
  const [previousKey, setPreviousKey] = useState(key);
  if (previousKey !== key) {
    setPreviousKey(key);
    setResult(null);
  }
  useEffect(() => {
    if (!headline) return;
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
        );
        if (request.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setResult({ key, status: "ready", blob, url });
      } catch {
        if (!request.signal.aborted) setResult({ key, status: "error" });
      }
    }
    void render(headline);
    return () => {
      request.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [headline, id, key, logo, placement, projectId]);

  return {
    result: headline && result?.key === key ? result : null,
    retry: () => setAttempt((value) => value + 1),
  };
}
