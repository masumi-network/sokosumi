import { afterEach, beforeEach } from "vitest";

const originalComplete = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  "complete",
);
const originalNaturalWidth = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  "naturalWidth",
);

/** happy-dom 20.10+ marks remote images complete with naturalWidth 0 immediately. */
export function stubPendingImageLoad() {
  beforeEach(() => {
    Object.defineProperty(HTMLImageElement.prototype, "complete", {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
      configurable: true,
      get: () => 0,
    });
  });

  afterEach(() => {
    if (originalComplete) {
      Object.defineProperty(
        HTMLImageElement.prototype,
        "complete",
        originalComplete,
      );
    }
    if (originalNaturalWidth) {
      Object.defineProperty(
        HTMLImageElement.prototype,
        "naturalWidth",
        originalNaturalWidth,
      );
    }
  });
}

/** happy-dom 20.10+ reports remote images as complete with naturalWidth 0. */
export function stubLoadedImage(natural = 64) {
  const complete = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "complete",
  );
  const naturalWidth = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "naturalWidth",
  );
  Object.defineProperty(HTMLImageElement.prototype, "complete", {
    configurable: true,
    get: () => true,
  });
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
    configurable: true,
    get: () => natural,
  });
  return () => {
    if (complete) {
      Object.defineProperty(HTMLImageElement.prototype, "complete", complete);
    }
    if (naturalWidth) {
      Object.defineProperty(
        HTMLImageElement.prototype,
        "naturalWidth",
        naturalWidth,
      );
    }
  };
}
