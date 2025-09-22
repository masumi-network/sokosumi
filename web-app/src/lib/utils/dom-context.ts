/**
 * Creates an isolated DOM context for server-side HTML processing.
 * Uses happy-dom for lightweight DOM implementation.
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

  // Import happy-dom for lightweight DOM implementation
  const { Window } = await import("happy-dom");
  const happyWindow = new Window();

  // Store original global values
  const originalGlobals = {
    window: (global as Record<string, unknown>).window,
    document: (global as Record<string, unknown>).document,
    HTMLElement: (global as Record<string, unknown>).HTMLElement,
    SVGElement: (global as Record<string, unknown>).SVGElement,
  };

  // Set up globals for libraries that require DOM APIs
  (global as Record<string, unknown>).window = happyWindow;
  (global as Record<string, unknown>).document = happyWindow.document;
  (global as Record<string, unknown>).HTMLElement = happyWindow.HTMLElement;
  (global as Record<string, unknown>).SVGElement = happyWindow.SVGElement;

  return () => {
    // Close happy-dom window
    happyWindow.close();

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
