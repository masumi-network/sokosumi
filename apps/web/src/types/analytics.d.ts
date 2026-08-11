/**
 * The GTM/GA data layer, declared once so the analytics code can use
 * `window.dataLayer` directly instead of asserting the shape at each call site.
 *
 * Entries are either a plain event object pushed by our own code, or the
 * `arguments` object gtag() pushes for its commands — hence `unknown`.
 */
declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

export {};
