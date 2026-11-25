"use client";

import { useEffect } from "react";

/**
 * Starts DESIGN.md generation on mount of the viewer-keyed `BrandSetup` child
 * once `viewerId` is known.
 */
export function useProjectBrandDesignMdStart(
  viewerId: string | undefined,
  websiteUrl: string,
  generate: (input: { url: string }) => Promise<void> | void,
): void {
  useEffect(() => {
    if (!viewerId) return;
    void generate({ url: websiteUrl });
  }, []);
}
