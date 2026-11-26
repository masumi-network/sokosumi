export type OS =
  | "Windows Phone"
  | "Windows"
  | "Android"
  | "Linux"
  | "iOS"
  | "MacOS"
  | "Unknown";

export type Browser =
  | "Edge"
  | "Opera"
  | "Samsung Internet"
  | "Firefox"
  | "Chrome"
  | "Safari";

/** A hint read from the user agent, not a verified identity. */
export function getBrowserFromUserAgent(ua: string): Browser | null {
  if (/Edg(?:e|A|iOS)?\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera|OPiOS\//i.test(ua)) return "Opera";
  if (/SamsungBrowser\//i.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//i.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS\//i.test(ua)) return "Chrome";
  if (/Version\/.*Safari\//i.test(ua)) return "Safari";
  return null;
}

export function getOSFromUserAgent(
  ua: string = (typeof navigator === "undefined" ? "" : navigator?.userAgent) ||
    "",
): { os: OS; isMobile: boolean } {
  if (/windows phone/i.test(ua)) {
    return {
      os: "Windows Phone",
      isMobile: true,
    };
  }
  if (/windows nt/i.test(ua)) {
    return {
      os: "Windows",
      isMobile: false,
    };
  }
  if (/android/i.test(ua)) {
    return {
      os: "Android",
      isMobile: true,
    };
  }
  if (/linux/i.test(ua) && !/android/i.test(ua)) {
    return {
      os: "Linux",
      isMobile: false,
    };
  }
  if (/iPad|iPhone|iPod/.test(ua)) {
    return {
      os: "iOS",
      isMobile: true,
    };
  }
  if (/macintosh|mac os x/i.test(ua)) {
    return {
      os: "MacOS",
      isMobile: false,
    };
  }
  return {
    os: "Unknown",
    isMobile: false,
  };
}

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const { os } = getOSFromUserAgent();
  return os === "MacOS" || os === "iOS";
}
