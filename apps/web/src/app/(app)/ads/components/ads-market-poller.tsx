"use client";

import { useRouter } from "next/navigation";

import { useMountEffect } from "@/hooks/use-mount-effect";

const POLL_MS = 20_000;

/**
 * Asks the route for fresh data while it is mounted. Mount it only while
 * Core is gathering; once the ads are ready it is no longer rendered.
 */
export function AdsMarketPoller() {
  const router = useRouter();

  useMountEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  });

  return null;
}
