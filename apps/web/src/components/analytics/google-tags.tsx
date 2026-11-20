"use client";

import { GoogleAnalytics, GoogleTagManager } from "@next/third-parties/google";

import { useInternalTrafficGate } from "@/hooks/effects/use-internal-traffic-gate";

interface GoogleTagsProps {
  gtmId?: string;
  gaId?: string;
}

/**
 * GTM + GA4, skipped for internal traffic (`sokosumi_internal=1`). Both tags
 * already load `afterInteractive`, so deciding after mount costs nothing.
 * Consent Mode init stays in the root layout and must still run first.
 */
export function GoogleTags({ gtmId, gaId }: GoogleTagsProps) {
  const enabled = useInternalTrafficGate();

  if (!enabled) {
    return null;
  }

  return (
    <>
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      {gaId && <GoogleAnalytics gaId={gaId} />}
    </>
  );
}
