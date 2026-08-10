import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webSrcRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * Guard: `@/lib/ts-res` was deleted (SOK-768). Fail CI if the module reappears.
 */
describe("ts-res ban", () => {
  it("does not restore the ts-res module under apps/web/src/lib", () => {
    expect(existsSync(path.join(webSrcRoot, "ts-res"))).toBe(false);
    expect(existsSync(path.join(webSrcRoot, "ts-res/index.ts"))).toBe(false);
    expect(existsSync(path.join(webSrcRoot, "ts-res/result.ts"))).toBe(false);
  });
});
