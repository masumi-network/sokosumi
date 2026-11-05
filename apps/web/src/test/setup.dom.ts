import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { cleanStores } from "nanostores";
import { afterEach, vi } from "vitest";

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

// Unmounting the last `useSession` subscriber makes nanostores stop the Better
// Auth session atom on a 1s timer, and that stop calls `window.
// removeEventListener`. A file that unmounts it near its end lets the timer
// fire after happy-dom is torn down: "window is not defined" as an unhandled
// error, exit code 1 on an otherwise green run. Pass the real client through
// and stop its session atom ourselves while `window` still exists. Files that
// mock the client never load the real one, so there is nothing to stop.
let authClientModule: typeof import("@/lib/auth/auth.client") | undefined;
vi.mock("@/lib/auth/auth.client", async (importOriginal) => {
  authClientModule = await importOriginal();
  return authClientModule;
});

afterEach(() => {
  cleanup();
  cleanStores(authClientModule?.authClient.$store.atoms.session);
});
