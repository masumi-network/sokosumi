"use client";

import { useSyncExternalStore } from "react";

import { isApplePlatform } from "@/lib/utils/user-agent";

const subscribe = () => () => {};

export default function useIsApplePlatform() {
  return useSyncExternalStore(subscribe, isApplePlatform, () => false);
}
