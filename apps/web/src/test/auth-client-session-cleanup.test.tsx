import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSession } from "@/lib/auth/auth.client";

function SessionSubscriber() {
  useSession();
  return null;
}

/**
 * Unmounting the last `useSession` subscriber makes nanostores schedule the
 * session atom's teardown 1s later. That teardown calls `window.
 * removeEventListener`, so it threw "window is not defined" whenever the timer
 * outlived happy-dom's teardown and failed an otherwise green run. `setup.dom`
 * stops the atom after each test; this proves the timer has nothing left to do
 * once `window` is gone.
 */
describe("real auth client session atom", () => {
  it("subscribes and unmounts", () => {
    render(<SessionSubscriber />).unmount();
  });

  it("leaves no cleanup timer that needs window", async () => {
    const win = globalThis.window;
    // @ts-expect-error happy-dom teardown deletes window while the worker lives on.
    delete globalThis.window;
    try {
      await new Promise((resolve) => setTimeout(resolve, 1300));
    } finally {
      globalThis.window = win;
    }
    expect(globalThis.window).toBe(win);
  });
});
