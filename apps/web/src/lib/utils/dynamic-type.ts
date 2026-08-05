export const DYNAMIC_TYPE_MAX_SCALE = 1.25 as const;
export const DYNAMIC_TYPE_DEFAULT_ROOT_PX = 16 as const;
export const DYNAMIC_TYPE_MAX_ROOT_PX = 20 as const; // 16 * 1.25

export function clampRootFontSizePx(computedPx: number): number {
  if (!Number.isFinite(computedPx) || computedPx <= 0) {
    return DYNAMIC_TYPE_DEFAULT_ROOT_PX;
  }
  return Math.min(computedPx, DYNAMIC_TYPE_MAX_ROOT_PX);
}

export function shouldApplyRootFontSizeInline(computedPx: number): boolean {
  return Number.isFinite(computedPx) && computedPx > DYNAMIC_TYPE_MAX_ROOT_PX;
}

export function applyDynamicTypeRootCap(
  root: HTMLElement = document.documentElement,
): void {
  const computedPx = Number.parseFloat(
    globalThis.getComputedStyle(root).fontSize,
  );
  if (shouldApplyRootFontSizeInline(computedPx)) {
    root.style.fontSize = `${DYNAMIC_TYPE_MAX_ROOT_PX}px`;
    return;
  }
  root.style.fontSize = "";
}
