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

  // Try to use happy-dom (ESM). If Jest can't transpile ESM from node_modules,
  // fall back to jsdom to keep tests working.
  let createdWindow: (Window & { close?: () => void }) | null = null;

  try {
    const { Window } = await import("happy-dom");
    createdWindow = new Window() as unknown as Window & { close?: () => void };
  } catch {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    createdWindow = dom.window as unknown as Window & { close?: () => void };
  }

  // Store original global values
  const originalGlobals = {
    window: (global as Record<string, unknown>).window,
    document: (global as Record<string, unknown>).document,
    HTMLElement: (global as Record<string, unknown>).HTMLElement,
    SVGElement: (global as Record<string, unknown>).SVGElement,
  };

  // Set up globals for libraries that require DOM APIs
  (global as Record<string, unknown>).window =
    createdWindow as unknown as Window;
  (global as Record<string, unknown>).document = (
    createdWindow as unknown as Window
  ).document;
  (global as Record<string, unknown>).HTMLElement = (
    createdWindow as unknown as Window & { HTMLElement: typeof HTMLElement }
  ).HTMLElement;
  (global as Record<string, unknown>).SVGElement = (
    createdWindow as unknown as Window & { SVGElement: typeof SVGElement }
  ).SVGElement;

  return () => {
    // Close happy-dom window
    createdWindow?.close();

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
