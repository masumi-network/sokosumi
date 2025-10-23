"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export default function useIsClient() {
  return useSyncExternalStore(
    subscribe,
    () => true, // Client-side: always true
    () => false, // Server-side: always false
  );
}
