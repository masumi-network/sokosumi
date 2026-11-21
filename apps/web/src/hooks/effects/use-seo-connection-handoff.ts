"use client";

import { useEffect, useRef, useState } from "react";

import {
  readSeoConnectionHandoff,
  type SeoConnectionCallbackContext,
} from "@/lib/seo/connection-callback";

/**
 * Reads and clears the SEO OAuth callback handoff carried in `window.name`
 * once on mount, surviving React StrictMode replay via a ref.
 */
export function useSeoConnectionHandoff() {
  const [context, setContext] = useState<
    SeoConnectionCallbackContext | null | undefined
  >();
  const handoff = useRef<SeoConnectionCallbackContext | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (handoff.current === undefined) {
      handoff.current = readSeoConnectionHandoff(window.name);
      window.name = "";
    }
    setContext(handoff.current);
  }, []);
  return context;
}
