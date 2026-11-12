import { describe, expect, it, vi } from "vitest";

import {
  MIGRATE_DEPLOY_RETRY_DELAYS_MS,
  migrateDeployWithRetry,
} from "./migrate-deploy-retry.js";

const UNREACHABLE = {
  code: 1,
  output: "Error: P1001: Can't reach database server at `ep-x.neon.tech:5432`",
};
const APPLIED = { code: 0, output: "All migrations have been applied." };

function harness(runs: { code: number; output: string }[]) {
  const run = vi.fn(async () => {
    const next = runs.shift();
    if (!next) throw new Error("ran more often than the test allows");
    return next;
  });
  const wait = vi.fn(async (_ms: number) => {});
  return { run, wait, log: vi.fn() };
}

describe("migrateDeployWithRetry", () => {
  it("runs again after P1001 and reports the later success", async () => {
    // The second run is how Prisma 7.10.1 prints it under FORCE_COLOR=1.
    const coloured = {
      code: 1,
      output:
        "\u001b[1m\u001b[31mError: \u001b[39m\u001b[22mP1001: Can't reach database server",
    };
    const h = harness([UNREACHABLE, coloured, APPLIED]);

    await expect(migrateDeployWithRetry(h)).resolves.toBe(0);

    expect(h.run).toHaveBeenCalledTimes(3);
    expect(h.wait.mock.calls.map(([ms]) => ms)).toEqual(
      MIGRATE_DEPLOY_RETRY_DELAYS_MS.slice(0, 2),
    );
  });

  it("does not retry a failure that reached the database", async () => {
    const h = harness([
      {
        code: 1,
        output:
          "Applying migration `20260101000000_P1001_note`\nError: P3018\nA migration failed to apply.",
      },
    ]);

    await expect(migrateDeployWithRetry(h)).resolves.toBe(1);

    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.wait).not.toHaveBeenCalled();
  });

  it("does not run again after a success whose output names P1001", async () => {
    const h = harness([
      { code: 0, output: `warn ${UNREACHABLE.output}\nAll applied.` },
    ]);

    await expect(migrateDeployWithRetry(h)).resolves.toBe(0);

    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("gives up with the failing code once the delays are used", async () => {
    const h = harness([UNREACHABLE, UNREACHABLE, UNREACHABLE]);

    await expect(
      migrateDeployWithRetry({ ...h, delaysMs: [1, 2] }),
    ).resolves.toBe(1);

    expect(h.run).toHaveBeenCalledTimes(3);
    expect(h.wait.mock.calls.map(([ms]) => ms)).toEqual([1, 2]);
  });
});
