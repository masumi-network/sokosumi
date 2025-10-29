"use client";

import { useSyncExternalStore } from "react";

interface WindowSize {
  innerWidth: number;
  outerWidth: number;
  innerHeight: number;
  outerHeight: number;
}

const readWindowSize = (): WindowSize => {
  return {
    innerWidth: window.innerWidth,
    outerWidth: window.outerWidth,
    innerHeight: window.innerHeight,
    outerHeight: window.outerHeight,
  };
};

export default function useWindowSize(): WindowSize | undefined {
  return useSyncExternalStore(
    // Subscribe function
    (callback) => {
      window.addEventListener("resize", callback);
      return () => window.removeEventListener("resize", callback);
    },
    // Client snapshot
    () => readWindowSize(),
    // Server snapshot
    () => undefined,
  );
}
