import { TextDecoder, TextEncoder } from "node:util";

import { createElement } from "react";
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

// `@lobehub/icons` does ESM directory-imports of `@lobehub/fluent-emoji` that
// Node's native ESM loader can't resolve under vitest, breaking collection of
// any test whose graph reaches it (e.g. via AgentSpotlight). Brand marks are
// presentational, so stub them globally.
vi.mock("@lobehub/icons", () => {
  const brands = [
    "Aws",
    "Claude",
    "Cohere",
    "DeepSeek",
    "Gemini",
    "Grok",
    "Meta",
    "Microsoft",
    "Mistral",
    "OpenAI",
    "Perplexity",
    "Qwen",
  ] as const;
  const exports: Record<string, unknown> = {
    __esModule: true,
    ModelIcon: () => null,
  };
  for (const name of brands) {
    exports[name] = () => createElement("svg", { "data-brand": name });
  }
  return exports;
});
