import { afterAll, vi } from "vitest";

/**
 * The unit suite runs with `isolate: false` (see `vitest.config.ts`): one
 * worker process runs many files, and Node keeps every `node_modules`
 * package it loaded. That reuse is the speed-up. Core's own modules must
 * still start fresh per file, because hundreds of files `vi.mock` the same
 * modules (`@/lib/db/prisma`, `@/middleware/auth`) with their own doubles,
 * and a module kept from an earlier file holds that file's doubles.
 *
 * `vi.resetModules()` resets every module except the `mock:` entries that
 * hold a factory's result. Vitest's own per-file isolation resets those too
 * (`resetModules(modules, true)` in its worker loop); without that, a file
 * mocking a path an earlier file in the worker also mocked gets the earlier
 * file's exports. The worker state is internal, so a Vitest upgrade that
 * moves it fails here loudly instead of leaking quietly.
 */
vi.resetModules();

const modules = (
  globalThis as {
    __vitest_worker__?: {
      evaluatedModules?: {
        idToModuleMap?: Map<
          string,
          {
            promise?: unknown;
            exports?: unknown;
            evaluated: boolean;
            importers: Set<string>;
          }
        >;
      };
    };
  }
).__vitest_worker__?.evaluatedModules?.idToModuleMap;
if (!(modules instanceof Map)) {
  throw new Error(
    "reset-per-file: Vitest worker module map not found; update this setup for the installed Vitest",
  );
}
for (const [id, node] of modules) {
  if (!id.startsWith("mock:")) continue;
  node.promise = undefined;
  node.exports = undefined;
  node.evaluated = false;
  node.importers.clear();
}

// Process-wide state outlives the file that set it. Vitest restores mocks
// between files itself; these three it does not.
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
