import { describe, expect, it } from "vitest";

import { getEnvSecrets } from "@/lib/secret-redaction";
import { causeMessage, expectCoreLogAtLoad } from "./core-log";

// Declared before the import that logs: a file's modules load before any
// `beforeEach`, so the test drain must already be in place.
const loaded = expectCoreLogAtLoad("warn", "Fixture logged while it loaded");
await import("./__fixtures__/log-at-import");
// evlog's process-wide config while the file loaded: silent writes nothing.
const silentAtLoad = (
  globalThis as Record<symbol, { config?: { silent?: boolean } }>
)[Symbol.for("evlog.registry.v2")]?.config?.silent;

describe("a module that logs while its test file loads", () => {
  it("lands in the test drain, silent and redacted", () => {
    const [secret] = getEnvSecrets();
    expect(secret).toBeDefined();
    expect(loaded).toHaveLength(1);
    const cause = causeMessage(loaded[0]?.cause);
    expect(cause).toContain("[redacted:env-secret]");
    expect(cause).not.toContain(secret);
    expect(silentAtLoad).toBe(true);
  });
});
