/**
 * Soft-keyboard heuristic for iOS Safari / standalone PWA and Android.
 *
 * Must be gated on an editable focus: iOS programmatic focus (room
 * `focusOnMount`) does not open the keyboard, and browser chrome can make
 * bare height deltas look like a keyboard (false positive → lost safe-area pb).
 *
 * When focused, compare visual/layout height to session maxima captured while
 * the keyboard was closed (and whenever the viewport grows).
 */
export const VISUAL_VIEWPORT_KEYBOARD_OPEN_THRESHOLD_PX = 150;

/** Largest layout viewport height seen while the keyboard was closed. */
let maxLayoutHeightPx = 0;
/** Largest visualViewport height seen while the keyboard was closed. */
let maxVisualHeightPx = 0;

/** Test / HMR helper — resets layout/visual baselines. */
export function resetVisualViewportKeyboardBaseline(): void {
  maxLayoutHeightPx = 0;
  maxVisualHeightPx = 0;
}

export function isEditableKeyboardTarget(
  target: EventTarget | null | undefined,
): boolean {
  if (target == null || typeof target !== "object") {
    return false;
  }
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
  };
  if (el.isContentEditable) {
    return true;
  }
  const tag = el.tagName;
  return tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT";
}

export interface VisualViewportKeyboardOpenOptions {
  thresholdPx?: number;
  maxLayoutHeightPx?: number;
  maxVisualHeightPx?: number;
  /** When false, never report open (idle / autofocus without OSK). */
  editableFocused?: boolean;
}

export function isVisualViewportKeyboardOpen(
  layoutHeight: number,
  visualViewportHeight: number | null | undefined,
  options?: VisualViewportKeyboardOpenOptions,
): boolean {
  const thresholdPx =
    options?.thresholdPx ?? VISUAL_VIEWPORT_KEYBOARD_OPEN_THRESHOLD_PX;
  const editableFocused = options?.editableFocused ?? true;
  if (!editableFocused) {
    return false;
  }

  const visualHeight = visualViewportHeight ?? layoutHeight;
  const maxLayout = options?.maxLayoutHeightPx ?? layoutHeight;
  const maxVisual = options?.maxVisualHeightPx ?? visualHeight;

  const visualShrink = maxVisual - visualHeight;
  const layoutShrink = maxLayout - layoutHeight;
  const visualDelta = layoutHeight - visualHeight;

  return (
    visualShrink > thresholdPx ||
    layoutShrink > thresholdPx ||
    visualDelta > thresholdPx
  );
}

export function readVisualViewportKeyboardOpen(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const layoutHeight = Math.max(
    window.innerHeight,
    document.documentElement.clientHeight,
  );
  const visualHeight = window.visualViewport?.height ?? layoutHeight;
  const editableFocused = isEditableKeyboardTarget(document.activeElement);

  // Grow baselines whenever the viewport is larger (keyboard closed / UI chrome
  // expanded). Do not shrink baselines while the keyboard is open.
  if (layoutHeight > maxLayoutHeightPx) {
    maxLayoutHeightPx = layoutHeight;
  }
  if (visualHeight > maxVisualHeightPx) {
    maxVisualHeightPx = visualHeight;
  }

  return isVisualViewportKeyboardOpen(layoutHeight, visualHeight, {
    maxLayoutHeightPx,
    maxVisualHeightPx,
    editableFocused,
  });
}
