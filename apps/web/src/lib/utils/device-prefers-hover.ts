/**
 * True when the primary input can hover (mouse/trackpad). False on touch
 * devices, which have an on-screen keyboard and no Shift+Enter. SSR → true.
 */
export function devicePrefersHover(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return window.matchMedia("(hover: hover)").matches;
}
