"use client";

import { useEffect } from "react";

interface UseProjectBrandSetupStartOptions {
  resolveIcon: () => void;
  viewerId: string | undefined;
  websiteUrl: string;
  generateDesignMd: (input: { url: string }) => Promise<void> | void;
}

/**
 * Starts `ProjectBrandSetup`'s site icon lookup first and then, once
 * `viewerId` is known, starts DESIGN.md generation so Next's serial
 * per-session server-action queue runs the icon lookup ahead of DESIGN.md.
 */
export function useProjectBrandSetupStart({
  resolveIcon,
  viewerId,
  websiteUrl,
  generateDesignMd,
}: UseProjectBrandSetupStartOptions): void {
  useEffect(() => {
    resolveIcon();
    if (!viewerId) return;
    void generateDesignMd({ url: websiteUrl });
  }, []);
}
