import { TextDecoder, TextEncoder } from "node:util";

import { vi } from "vitest";

// Both projects. DOM-only setup (jest-dom, Testing Library cleanup, the WAAPI
// patch) lives in `setup.dom.ts`, which only the happy-dom project loads.

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

// `@lobehub/icons` (ModelIcon) does ESM directory-imports of `@lobehub/fluent-emoji`
// that Node's native ESM loader can't resolve under vitest, breaking collection of
// any test whose graph reaches it (e.g. via AgentSpotlight). It's a purely
// presentational icon, so stub it globally.
vi.mock("@lobehub/icons", () => ({
  __esModule: true,
  ModelIcon: () => null,
}));
