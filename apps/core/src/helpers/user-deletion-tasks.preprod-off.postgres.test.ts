import type { Prisma } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { onSplitLayout } from "@/test/split-layout";
import { seedDeletionWorld } from "@/test-fixtures/user-deletion-world";

vi.mock("@sentry/node", () => ({ captureMessage: vi.fn() }));

// Only the split layout has a Preprod schema to stay away from. PostgreSQL
// decides: with that schema renamed away, a statement that names it fails.
describe.runIf(onSplitLayout)(
  "the account deletion while Preprod is off",
  () => {
    let prisma: typeof import("@/lib/db/prisma").default;
    let prepareTasksForUserDeletion: typeof import("./user-deletion-tasks").prepareTasksForUserDeletion;

    beforeAll(async () => {
      vi.stubEnv("NETWORK_PREPROD_ENABLED", "false");
      ({ default: prisma } = await import("@/lib/db/prisma"));
      ({ prepareTasksForUserDeletion } = await import("./user-deletion-tasks"));
    }, 60_000);

    afterAll(() => vi.unstubAllEnvs());

    it("deletes the account on Mainnet without a statement on Preprod", async () => {
      const rollback = new Error("Roll back the world");
      let users: unknown[] | undefined;
      await expect(
        prisma.$transaction(
          async (tx) => {
            const { ada } = await seedDeletionWorld(tx, ["mainnet"]);
            await tx.$executeRaw`ALTER SCHEMA "preprod" RENAME TO "preprod_renamed_away"`;

            await prepareTasksForUserDeletion(ada, {
              $transaction: (
                callback: (
                  client: Prisma.TransactionClient,
                ) => Promise<unknown>,
              ) => callback(tx),
            } as never);

            users = await tx.user.findMany({ where: { id: ada } });
            throw rollback;
          },
          { timeout: 60_000 },
        ),
      ).rejects.toBe(rollback);
      expect(users).toEqual([]);
    }, 60_000);
  },
);
