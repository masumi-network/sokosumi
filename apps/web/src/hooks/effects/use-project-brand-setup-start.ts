"use client";

import { useEffect } from "react";

interface UseProjectBrandSetupStartOptions {
  generate: (input: { url: string }) => Promise<void> | void;
  resolveIcon: () => void;
  viewerId: string | undefined;
  websiteUrl: string;
}

/**
 * Starts project site-icon resolution on mount and begins DESIGN.md generation
 * once the keyed `BrandSetup` step mounts with a known viewer id.
 */
export function useProjectBrandSetupStart({
  generate,
  resolveIcon,
  viewerId,
  websiteUrl,
}: UseProjectBrandSetupStartOptions): void {
  useEffect(() => {
    resolveIcon();
    if (!viewerId) return;
    void generate({ url: websiteUrl });
  }, []);
}
