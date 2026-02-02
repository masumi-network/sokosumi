"use client";

import { useEffect, useRef, useState } from "react";

import { getOSFromUserAgent, type OS } from "@/lib/utils";

interface OSInfo {
  os: OS;
  isMobile: boolean;
}

/**
 * Hook to detect the user's operating system from the user agent.
 * Uses requestAnimationFrame to defer detection until after hydration,
 * avoiding hydration mismatches when server and client values differ.
 */
export function useOSDetection(): OSInfo {
  const [osInfo, setOsInfo] = useState<OSInfo>({
    os: "Unknown",
    isMobile: false,
  });
  const hasMounted = useRef(false);

  useEffect(() => {
    if (hasMounted.current) return;

    hasMounted.current = true;
    const frame = requestAnimationFrame(() => {
      setOsInfo(getOSFromUserAgent());
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  return osInfo;
}
