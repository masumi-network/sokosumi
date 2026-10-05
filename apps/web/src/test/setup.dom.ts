import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// happy-dom project only. Loading jest-dom and Testing Library (and through it
// react-dom) costs every test file that imports this, so the node project
// skips it.

// happy-dom 20.12+ implements WAAPI. `Animation.cancel()` rejects `finished`
// with AbortError (spec). motion 13 calls cancel on unmount and does not catch
// that promise, so vitest reports unhandled rejections.
const animationPrototype = globalThis.Animation?.prototype;
if (animationPrototype) {
  const originalCancel = animationPrototype.cancel;
  animationPrototype.cancel = function cancel(this: Animation) {
    const finished = this.finished;
    originalCancel.call(this);
    void finished.catch((reason: unknown) => {
      if (
        reason instanceof Error &&
        reason.name === "AbortError" &&
        reason.message === "The animation was canceled."
      ) {
        return;
      }
      throw reason;
    });
  };
}

afterEach(() => {
  cleanup();
});
