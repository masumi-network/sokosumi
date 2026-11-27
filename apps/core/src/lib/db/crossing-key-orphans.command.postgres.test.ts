import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { netTable } from "@sokosumi/database/sql-tables";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

const CORE = fileURLToPath(new URL("../../..", import.meta.url));
const ORPHAN_ID = "crossing-key-orphans-command-test";

/** The exit status a caller of the documented command sees. */
function orphanCheck(env: Record<string, string> = {}) {
  // The command of the script's header, without `--env-file`: this process
  // already holds Core's environment.
  const run = spawnSync(
    "pnpm",
    ["--dir", CORE, "exec", "tsx", "scripts/check-crossing-key-orphans.mts"],
    { env: { ...process.env, ...env }, encoding: "utf8", timeout: 60_000 },
  );
  return { status: run.status, output: run.stdout };
}

// The gate of ticket 54 reads this status, so it is pinned where a person
// reads it: at the command, not inside the script.
describe.runIf(ON_POSTGRES)("the orphan check command", () => {
  let prisma: typeof import("./prisma").default;

  beforeAll(async () => {
    ({ default: prisma } = await import("./prisma"));
  }, 60_000);

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM ${netTable("mainnet", "UserAgentRating")} WHERE "id" = ${ORPHAN_ID}`;
  }, 60_000);

  it("exits 0 when no crossing id is without its target", () => {
    const { status, output } = orphanCheck();
    expect(output).toContain("mainnet\tUserAgentRating.userId\t0");
    expect(status).toBe(0);
  }, 90_000);

  it("exits 3 on an orphan, and names it", async () => {
    await prisma.$transaction(async (tx) => {
      // The keys still exist: plant the row with them switched off.
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`
        INSERT INTO ${netTable("mainnet", "UserAgentRating")} ("id", "updatedAt", "rating", "userId", "agentId")
        VALUES (${ORPHAN_ID}, now(), 4, 'no-such-user', 'no-such-agent')`;
    });

    const { status, output } = orphanCheck();

    expect(output).toContain("mainnet\tUserAgentRating.userId\t1");
    expect(status).toBe(3);
  }, 90_000);

  it("exits 2 when the query fails", () => {
    const url = new URL(process.env.DATABASE_URL as string);
    url.pathname = "/no_such_database_for_the_orphan_check";
    expect(orphanCheck({ DATABASE_URL: url.toString() }).status).toBe(2);
  }, 90_000);
});
