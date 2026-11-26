/**
 * `packages/database/prisma/network-layout/shared-trigger-bodies.sql`: the
 * trigger bodies of the new layout. Its guard refuses today's layout and a
 * layout where a trigger would keep the old body; that a refusal leaves
 * nothing behind is the caller's transaction (the file's header). That the
 * bodies resolve their names is proven by the suites that run on the split
 * layout and fire these triggers, not here; `split-network-layout.sh` checks
 * that every function of `shared` is in the file or waits.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { onSplitLayout } from "@/test/split-layout";

import { refusal } from "./rolled-back";

const BODIES_SQL = readFileSync(
  new URL(
    "../../../../../../packages/database/prisma/network-layout/shared-trigger-bodies.sql",
    import.meta.url,
  ),
  "utf8",
);
const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

describe.runIf(ON_POSTGRES)("shared trigger bodies", () => {
  describe.runIf(!onSplitLayout)("on today's layout", () => {
    it("refuses", async () => {
      expect(await refusal(BODIES_SQL)).toBe(
        "shared-trigger-bodies.sql needs the three-schema layout; missing schema: mainnet, preprod, shared",
      );
    });

    it("refuses three schemas that do not hold the functions", async () => {
      expect(
        await refusal(
          BODIES_SQL,
          "CREATE SCHEMA shared; CREATE SCHEMA mainnet; CREATE SCHEMA preprod",
        ),
      ).toBe(
        "shared-trigger-bodies.sql needs the three-schema layout; missing function: shared.calendar_access_cleanup_on_member_delete()",
      );
    });
  });

  describe.runIf(onSplitLayout)("on the split layout", () => {
    it("refuses while a trigger still runs a function of the file outside shared", async () => {
      const message = await refusal(
        BODIES_SQL,
        `ALTER FUNCTION shared.task_assign_number() SET SCHEMA public;
         CREATE FUNCTION shared.task_assign_number() RETURNS trigger
           LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'`,
      );

      expect(message).toContain(
        "runs a task_assign_number that is not in shared",
      );
    });

    // The split script already applied the file, so every digest differs
    // from the migrated one and the refusal lists all of them.
    it.each([
      "SET LOCAL quote_all_identifiers = on",
      "SET LOCAL extra_float_digits = -6",
    ])("finds the same digests after %s", async (setting) => {
      const control = await refusal(BODIES_SQL);

      expect(control).toContain("a migration changed this function:");
      expect(await refusal(BODIES_SQL, setting)).toBe(control);
    });
  });
});
