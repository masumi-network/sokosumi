import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Resolves to `apps/web/src/lib` (former home of `@/lib/ts-res`). */
const webLibRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * Guard: `@/lib/ts-res` was deleted (SOK-768). Fail CI if the module reappears.
 */
describe("ts-res ban", () => {
  it("does not restore the ts-res module under apps/web/src/lib", () => {
    expect(existsSync(path.join(webLibRoot, "ts-res"))).toBe(false);
    expect(existsSync(path.join(webLibRoot, "ts-res/index.ts"))).toBe(false);
    expect(existsSync(path.join(webLibRoot, "ts-res/result.ts"))).toBe(false);
  });
});
