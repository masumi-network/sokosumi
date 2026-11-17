import { AsyncLocalStorage } from "node:async_hooks";
import { TextDecoder, TextEncoder } from "node:util";

import { createElement } from "react";
import { afterAll, vi } from "vitest";

import { installConsoleGuard } from "./console";

// Test files share a worker (`isolate: false`). Start each file with a fresh
// module registry so its `vi.mock` calls apply even when an earlier file
// already imported the real module, and hand the next file clean globals.
vi.resetModules();

// Next reads this global once, when its first server module loads, and
// otherwise keeps a stand-in whose `run()` throws. Next's Node server sets it
// before any of its code runs (`next/dist/server/node-environment-baseline`);
// with modules shared across files, whichever file loads Next first would
// decide for the rest. The happy-dom project stands in for the browser, which
// has none.
if (typeof window === "undefined") {
  Object.assign(globalThis, { AsyncLocalStorage });
}

// A file can also replace a global by plain assignment or
// `Object.defineProperty` (`window.location`), which `vi.unstubAllGlobals`
// does not undo. Only globals that existed before the file are put back: a
// global a dependency installs on first load (Next's `AsyncLocalStorage`) has
// to stay, because the dependency stays loaded and never installs it again.
const globalsBefore = Object.getOwnPropertyDescriptors(globalThis);

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreGlobals();
});

function restoreGlobals() {
  const before = globalsBefore as Record<PropertyKey, PropertyDescriptor>;
  for (const key of Reflect.ownKeys(before)) {
    const was = before[key];
    const now = Object.getOwnPropertyDescriptor(globalThis, key);
    const changed =
      !now ||
      (now.configurable &&
        (now.value !== was.value ||
          now.get !== was.get ||
          now.set !== was.set));
    if (changed) Object.defineProperty(globalThis, key, was);
  }
}

// Both projects. DOM-only setup (jest-dom, Testing Library cleanup, the WAAPI
// patch) lives in `setup.dom.ts`, which only the happy-dom project loads.

if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = TextEncoder;
}

if (typeof globalThis.TextDecoder === "undefined") {
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
}

installConsoleGuard();

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
