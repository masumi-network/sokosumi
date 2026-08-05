export const MOBILE_CHROME_APPLE_SURFACE_CLASS =
  "bg-background/45 backdrop-blur-2xl backdrop-saturate-150 dark:bg-background/35";

export const MOBILE_CHROME_SOLID_SURFACE_CLASS = "bg-background";

export function mobileChromeSurfaceClass(isApple: boolean): string {
  return isApple
    ? MOBILE_CHROME_APPLE_SURFACE_CLASS
    : MOBILE_CHROME_SOLID_SURFACE_CLASS;
}
