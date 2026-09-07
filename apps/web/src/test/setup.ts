import "@testing-library/jest-dom/vitest";

import { TextDecoder, TextEncoder } from "node:util";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = TextEncoder;
}

if (typeof globalThis.TextDecoder === "undefined") {
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
}

const originalConsoleError = console.error;

console.error = (...args: unknown[]) => {
  const [firstArg] = args;

  if (
    typeof firstArg === "string" &&
    firstArg.includes("ReactDOMTestUtils.act")
  ) {
    return;
  }

  originalConsoleError(...args);
};

if (typeof globalThis.__dirname === "undefined") {
  globalThis.__dirname = process.cwd();
}

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

vi.mock("uuid", () => ({
  __esModule: true,
  parse: () => new Array(16).fill(0),
  stringify: () => "00000000-0000-0000-0000-000000000000",
  v1: () => "mock-uuid-v1",
  v3: () => "mock-uuid-v3",
  v4: () => "mock-uuid-v4",
  v5: () => "mock-uuid-v5",
  validate: () => true,
}));

// `@lobehub/icons` (ModelIcon) does ESM directory-imports of `@lobehub/fluent-emoji`
// that Node's native ESM loader can't resolve under vitest, breaking collection of
// any test whose graph reaches it (e.g. via AgentSpotlight). It's a purely
// presentational icon, so stub it globally.
vi.mock("@lobehub/icons", () => ({
  __esModule: true,
  ModelIcon: () => null,
}));
