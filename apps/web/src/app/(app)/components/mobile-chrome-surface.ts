// `--overlay` is the guide's Alpha 50 scrim now, not frosted page glass, so
// the chrome is opaque here too (guide 5.5: no blur).
export const MOBILE_CHROME_APPLE_SURFACE_CLASS = "bg-background";

export const MOBILE_CHROME_SOLID_SURFACE_CLASS = "bg-background";

export function mobileChromeSurfaceClass(isApple: boolean): string {
  return isApple
    ? MOBILE_CHROME_APPLE_SURFACE_CLASS
    : MOBILE_CHROME_SOLID_SURFACE_CLASS;
}
