/**
 * Creates an isolated DOM context for server-side HTML processing.
 * Uses JSDOM for DOM implementation.
 * Returns a cleanup function to restore the original state.
 *
 * @returns A cleanup function that restores the original global state
 *
 * @example
 * ```typescript
 * const cleanup = await setupDomContext();
 * try {
 *   // Your DOM-dependent code here
 * } finally {
 *   cleanup();
 * }
 * ```
 */
export async function setupDomContext(): Promise<() => void> {
  // Check if we're already in a browser environment
  if (typeof document !== "undefined") {
    return () => {};
  }

  const { JSDOM } = await import("jsdom");
  const window = new JSDOM().window;
  if (!window) {
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
  (global as Record<string, unknown>).window = window;
  (global as Record<string, unknown>).document = window.document;
  (global as Record<string, unknown>).HTMLElement = window.HTMLElement;
  (global as Record<string, unknown>).SVGElement = window.SVGElement;

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
