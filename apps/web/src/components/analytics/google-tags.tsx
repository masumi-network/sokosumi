"use client";

import { GoogleAnalytics, GoogleTagManager } from "@next/third-parties/google";
import { useState } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  syncInternalTraffic,
  withoutInternalTrafficParam,
} from "@/lib/analytics/internal-traffic";

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
  const [enabled, setEnabled] = useState(false);

  useMountEffect(() => {
    setEnabled(!syncInternalTraffic(window.location.search));
    const cleanUrl = withoutInternalTrafficParam(window.location.href);
    if (cleanUrl) {
      window.history.replaceState(window.history.state, "", cleanUrl);
    }
  });

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
