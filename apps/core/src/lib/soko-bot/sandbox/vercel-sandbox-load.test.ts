import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Core's production bundle is ESM and statically imports `@vercel/sandbox`.
 * Vercel then loads the CJS dependency of that import through
 * `/opt/rust/nodejs.js` `Module._load`, which throws `ERR_REQUIRE_ESM`.
 * Node 26 does not: `process.features.require_module` is true. This flag is
 * that rejection.
 *
 * `@vercel/sandbox` 4.1.0's ESM entry imports CJS `@vercel/drives`, whose
 * `dist/drive.js` does `require("@workflow/serde")`. `@workflow/serde` is
 * `"type": "module"` (no top-level await). That require kills every Core
 * cold start. 4.0.0 imports serde with `import`.
 */
const CORE_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

describe("@vercel/sandbox under a require() that rejects ES modules", () => {
  it("imports", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--no-experimental-require-module",
        "--input-type=module",
        "-e",
        [
          'import("@vercel/sandbox").then((mod) => {',
          "  if (mod.Sandbox == null || mod.Drive == null) process.exit(2);",
          "}).catch((error) => {",
          "  process.stderr.write(`${error?.code ?? error}\\n`);",
          "  process.exit(1);",
          "});",
        ].join("\n"),
      ],
      { cwd: CORE_ROOT, encoding: "utf8", timeout: 30_000 },
    );

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
  });
});
