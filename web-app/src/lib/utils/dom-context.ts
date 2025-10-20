import type { Window as HappyDomWindow } from "happy-dom";

/**
 * Creates an isolated DOM context for server-side HTML processing.
 * Uses happy-dom for lightweight DOM implementation.
 * Returns a cleanup function to restore the original state.
 *
 * @returns A cleanup function that restores the original global state
 *
 * @example
 * ```typescript
 * const cleanup = await setupDomContext(providedWindow);
 * try {
 *   // Your DOM-dependent code here
 * } finally {
 *   cleanup();
 * }
 * ```
 */
export async function setupDomContext(
  provided?: Window | HappyDomWindow,
): Promise<() => void> {
  // Check if we're already in a browser environment
  if (typeof document !== "undefined") {
    return () => {};
  }

  const win = provided ?? (globalThis as { window?: Window }).window;
  if (!win) {
    throw new Error("setupDomContext: no window provided");
  }

  // Store original global values
  const originalGlobals = {
    window: (global as Record<string, unknown>).window,
    document: (global as Record<string, unknown>).document,
    HTMLElement: (global as Record<string, unknown>).HTMLElement,
    SVGElement: (global as Record<string, unknown>).SVGElement,
  };

  // Set up globals for libraries that require DOM APIs
  (global as Record<string, unknown>).window = win as Window;
  (global as Record<string, unknown>).document = (win as Window).document;
  (global as Record<string, unknown>).HTMLElement = (
    win as unknown as Window & { HTMLElement: typeof HTMLElement }
  ).HTMLElement;
  (global as Record<string, unknown>).SVGElement = (
    win as unknown as Window & { SVGElement: typeof SVGElement }
  ).SVGElement;

  return () => {
    // Restore original globals
    if (originalGlobals.window !== undefined) {
      (global as Record<string, unknown>).window = originalGlobals.window;
    } else {
      delete (global as Record<string, unknown>).window;
    }
    if (originalGlobals.document !== undefined) {
      (global as Record<string, unknown>).document = originalGlobals.document;
    } else {
      delete (global as Record<string, unknown>).document;
    }
    if (originalGlobals.HTMLElement !== undefined) {
      (global as Record<string, unknown>).HTMLElement =
        originalGlobals.HTMLElement;
    } else {
      delete (global as Record<string, unknown>).HTMLElement;
    }
    if (originalGlobals.SVGElement !== undefined) {
      (global as Record<string, unknown>).SVGElement =
        originalGlobals.SVGElement;
    } else {
      delete (global as Record<string, unknown>).SVGElement;
    }
  };
}
