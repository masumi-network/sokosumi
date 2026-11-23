import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { CLI_COMMAND_CATALOG } from "../../src/cli/commands/discover.js";

const MANIFEST_DIR = new URL("../../../core/agent-surface/", import.meta.url);

interface Manifest {
  readonly operations?: Record<string, { readonly cli?: unknown }>;
}

test("every CLI command in the agent-surface manifests is in the catalog", () => {
  const catalog = new Set<string>(
    CLI_COMMAND_CATALOG.map((entry) => entry.command),
  );
  const unknown = readdirSync(MANIFEST_DIR)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const manifest: Manifest = JSON.parse(
        readFileSync(new URL(name, MANIFEST_DIR), "utf8"),
      );
      return Object.entries(manifest.operations ?? {})
        .filter(
          ([, row]) => typeof row.cli === "string" && !catalog.has(row.cli),
        )
        .map(
          ([op, row]) => `apps/core/agent-surface/${name} "${op}": ${row.cli}`,
        );
    });

  assert.deepEqual(
    unknown,
    [],
    "Each manifest cli value must be a CLI_COMMAND_CATALOG command (apps/cli/src/cli/commands/discover.ts).",
  );
});
