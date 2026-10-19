"use client";

import { useSyncExternalStore } from "react";

import { getOSFromUserAgent, type OS } from "@/lib/utils/user-agent";

interface OSInfo {
  os: OS;
  isMobile: boolean;
}

const SERVER_OS_INFO: OSInfo = {
  os: "Unknown",
  isMobile: false,
};

let cachedUserAgent: string | null = null;
let cachedOsInfo: OSInfo = SERVER_OS_INFO;

const subscribe = () => () => {};

function getClientOsInfo(): OSInfo {
  const userAgent = navigator.userAgent;
  if (cachedUserAgent === userAgent) {
    return cachedOsInfo;
  }
  cachedUserAgent = userAgent;
  cachedOsInfo = getOSFromUserAgent();
  return cachedOsInfo;
}

function getServerOsInfo(): OSInfo {
  return SERVER_OS_INFO;
}

export function useOSDetection(): OSInfo {
  return useSyncExternalStore(subscribe, getClientOsInfo, getServerOsInfo);
}
