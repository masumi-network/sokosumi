"use client";

import { useEffect, useEffectEvent } from "react";

import { consumeStudioWebsiteDraftRequest } from "@/app/projects/components/image-studio/studio-website-intent";

/**
 * Consumes a pending website-draft auto-prepare request for `StudioWebsiteTools`
 * on mount (or React Activity reveal) when the project has a website URL.
 */
export function useStudioWebsiteDraftRequest(
  projectId: string,
  websiteUrl: string | null | undefined,
  onRequested: () => void,
): void {
  const checkRequest = useEffectEvent(() => {
    if (websiteUrl && consumeStudioWebsiteDraftRequest(projectId)) {
      onRequested();
    }
  });

  useEffect(() => {
    checkRequest();
  }, []);
}
