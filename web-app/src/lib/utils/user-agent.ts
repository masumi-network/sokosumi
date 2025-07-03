export type OS =
  | "Windows Phone"
  | "Windows"
  | "Android"
  | "Linux"
  | "iOS"
  | "MacOS"
  | "Unknown";

export function getOSFromUserAgent(): { os: OS; isMobile: boolean } {
  const ua = navigator?.userAgent || "";

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
