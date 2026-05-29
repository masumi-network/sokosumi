"use client";

import { useSyncExternalStore } from "react";

function getIsApplePlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const navUaPlatform = (
    navigator as unknown as { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  const platform = navUaPlatform ?? navigator.platform ?? "";
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

const subscribe = () => () => {};

export default function useIsApplePlatform() {
  return useSyncExternalStore(subscribe, getIsApplePlatform, () => false);
}
