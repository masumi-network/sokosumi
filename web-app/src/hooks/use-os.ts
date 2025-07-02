export type OS =
  | "Windows Phone"
  | "Windows"
  | "Android"
  | "Linux"
  | "iOS"
  | "MacOS"
  | "Unknown";

export default function getOSFromUserAgent(): OS {
  const ua = navigator.userAgent;

  if (/windows phone/i.test(ua)) {
    return "Windows Phone";
  }
  if (/windows nt/i.test(ua)) {
    return "Windows";
  }
  if (/android/i.test(ua)) {
    return "Android";
  }
  if (/linux/i.test(ua) && !/android/i.test(ua)) {
    return "Linux";
  }
  if (/iPad|iPhone|iPod/.test(ua)) {
    return "iOS";
  }
  if (/macintosh|mac os x/i.test(ua)) {
    return "MacOS";
  }
  return "Unknown";
}
