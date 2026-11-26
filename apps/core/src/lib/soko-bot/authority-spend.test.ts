import { ownerAuthoritySchema } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import {
  AUTHORITY_SPEND_STATUS,
  checkGrantSpendPreflight,
  type MediaSpendGrant,
  reserveAuthoritySpend,
  settleAuthoritySpend,
  summarizeGrantBuckets,
} from "./authority-spend";

const BOT_ID = "0193a000-0000-7000-8000-000000000001";
const WS_ID = "0193a000-0000-7000-8000-000000000002";
const OWNER_ID = "0193a000-0000-7000-8000-000000000003";
const PROJECT_A = "0193a000-0000-7000-8000-0000000000aa";
const PROJECT_B = "0193a000-0000-7000-8000-0000000000bb";

interface SpendRow {
  sokoBotId: string;
  workspaceId: string;
  grantId: string;
  operationKey: string | null;
  turnId: string;
  toolCallId: string;
  capability: string;
  images: number;
  videos: number;
  credits: number;
  status: string;
}

interface LegacyCallRow {
  turnId: string;
  toolCallId: string;
  capability: string;
  disposition: string | null;
  input: { maxCredits: number };
}

function createInMemorySpendDb() {
  const rows: SpendRow[] = [];
  const legacyCalls: LegacyCallRow[] = [];
  const lockedKeys: string[] = [];

  const matchesNot = (
    row: { turnId: string; toolCallId: string },
    not?: { turnId?: string; toolCallId?: string },
  ) =>
    Boolean(
      not &&
        (not.turnId === undefined || row.turnId === not.turnId) &&
        row.toolCallId === not.toolCallId,
    );

  const client = {
    rows,
    legacyCalls,
    lockedKeys,
    $executeRaw: async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      if (typeof values[0] === "string") lockedKeys.push(values[0]);
      return 1;
    },
    sokoBotAuthoritySpend: {
      findMany: async ({
        where,
      }: {
        where: {
          sokoBotId?: string;
          grantId?: string;
          turnId?: { in: string[] };
          status?: { in: string[] };
          NOT?: { turnId?: string; toolCallId?: string };
        };
      }) =>
        rows.filter(
          (row) =>
            (!where.sokoBotId || row.sokoBotId === where.sokoBotId) &&
            (!where.grantId || row.grantId === where.grantId) &&
            (!where.turnId || where.turnId.in.includes(row.turnId)) &&
            (!where.status || where.status.in.includes(row.status)) &&
            !matchesNot(row, where.NOT),
        ),
      findUnique: async ({
        where,
      }: {
        where:
          | { operationKey: string }
          | { turnId_toolCallId: { turnId: string; toolCallId: string } };
      }) => {
        if ("operationKey" in where) {
          return (
            rows.find((row) => row.operationKey === where.operationKey) ?? null
          );
        }
        return (
          rows.find(
            (row) =>
              row.turnId === where.turnId_toolCallId.turnId &&
              row.toolCallId === where.turnId_toolCallId.toolCallId,
          ) ?? null
        );
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { turnId_toolCallId: { turnId: string; toolCallId: string } };
        create: SpendRow;
        update: Partial<SpendRow>;
      }) => {
        if (
          create.operationKey !== null &&
          rows.some(
            (row) =>
              row.operationKey === create.operationKey &&
              !(
                row.turnId === where.turnId_toolCallId.turnId &&
                row.toolCallId === where.turnId_toolCallId.toolCallId
              ),
          )
        ) {
          throw new Error("Unique constraint failed on operationKey");
        }
        const index = rows.findIndex(
          (row) =>
            row.turnId === where.turnId_toolCallId.turnId &&
            row.toolCallId === where.turnId_toolCallId.toolCallId,
        );
        if (index >= 0) {
          rows[index] = { ...rows[index]!, ...update };
          return rows[index]!;
        }
        rows.push({ ...create });
        return create;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          turnId: string;
          toolCallId: string;
          status?: string | { in: string[] };
        };
        data: Partial<SpendRow>;
      }) => {
        let count = 0;
        for (const row of rows) {
          const statusMatch =
            where.status === undefined
              ? true
              : typeof where.status === "string"
                ? row.status === where.status
                : where.status.in.includes(row.status);
          if (
            row.turnId === where.turnId &&
            row.toolCallId === where.toolCallId &&
            statusMatch
          ) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    sokoBotToolCall: {
      findMany: async ({
        where,
      }: {
        where: {
          turnId: { in: string[] };
          capability: { in: string[] };
          NOT?: { turnId?: string; toolCallId?: string };
        };
      }) =>
        legacyCalls.filter(
          (call) =>
            where.turnId.in.includes(call.turnId) &&
            where.capability.in.includes(call.capability) &&
            call.disposition !== "REJECTED" &&
            !matchesNot(call, where.NOT),
        ),
    },
  };
  return client;
}

function makeDelegationAuthority(input: {
  grantId: string;
  images?: number;
  maxMediaCredits?: number;
  projectId?: string;
}) {
  return ownerAuthoritySchema.parse({
    version: 1,
    grantId: input.grantId,
    origin: "owner_chat",
    sokoBotId: BOT_ID,
    workspaceId: WS_ID,
    ownerUserId: OWNER_ID,
    rootTurnId: input.grantId,
    targetScope: input.projectId
      ? { kind: "project", projectId: input.projectId }
      : { kind: "workspace" },
    scope: "draft_and_workspace",
    socialMode: "draft_only",
    ...(input.images !== undefined || input.maxMediaCredits !== undefined
      ? {
          limits: {
            grantId: input.grantId,
            period: "lifetime",
            ...(input.images !== undefined ? { images: input.images } : {}),
            ...(input.maxMediaCredits !== undefined
              ? { maxMediaCredits: input.maxMediaCredits }
              : {}),
          },
        }
      : {}),
    stopRule: { mode: "never" },
  });
}

describe("authority-spend", () => {
  it("collapses parallel children sharing one grantId into a single tight bucket instead of summing them", () => {
    const childA = makeDelegationAuthority({
      grantId: "grant-root-1",
      images: 2,
      maxMediaCredits: 20,
    });
    const childB = makeDelegationAuthority({
      grantId: "grant-root-1",
      images: 2,
      maxMediaCredits: 15,
    });
    const nonMediaPlan = makeDelegationAuthority({
      grantId: "grant-other-unlimited",
    });

    const summarized = summarizeGrantBuckets([
      { authority: childA },
      { authority: childB },
      { authority: nonMediaPlan },
    ]);

    expect(summarized.unboundedPerTurn).toBe(false);
    expect(summarized.grants).toEqual([
      {
        grantId: "grant-root-1",
        images: 2,
        videos: undefined,
        maxMediaCredits: 15,
        targetScope: { kind: "workspace" },
      },
    ]);
  });

  it("enforces one shared durable grantId balance across two separate parallel child wakes", async () => {
    const db = createInMemorySpendDb();
    const sharedGrant: MediaSpendGrant = {
      grantId: "grant-shared",
      images: 2,
      maxMediaCredits: 20,
      targetScope: { kind: "workspace" },
    };

    const first = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "wake-child-a",
      toolCallId: "img-1",
      operationKey: "op-a-1",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 10,
      grants: [sharedGrant],
    });
    expect(first).toEqual({ grantId: "grant-shared", reused: false });

    const second = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "wake-child-b",
      toolCallId: "img-1",
      operationKey: "op-b-1",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 10,
      grants: [sharedGrant],
    });
    expect(second).toEqual({ grantId: "grant-shared", reused: false });

    // Third image across either child exceeds the shared 2-image grant.
    await expect(
      reserveAuthoritySpend(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "wake-child-b",
        toolCallId: "img-2",
        operationKey: "op-b-2",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 5,
        grants: [sharedGrant],
      }),
    ).rejects.toThrow("The owner asked for 2 images in this plan");
    expect(db.rows).toHaveLength(2);
  });

  it("settles one reservation when two children retry the same operationKey against their shared allowance", async () => {
    const db = createInMemorySpendDb();
    const sharedGrant: MediaSpendGrant = {
      grantId: "grant-retry-shared",
      images: 1,
      maxMediaCredits: 10,
      targetScope: { kind: "workspace" },
    };

    const first = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "wake-child-a",
      toolCallId: "call-a",
      operationKey: "shared-op-key",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 10,
      grants: [sharedGrant],
    });
    expect(first).toEqual({ grantId: "grant-retry-shared", reused: false });

    // Second child retrying the exact same paid operationKey reuses the single reservation.
    const retry = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "wake-child-b",
      toolCallId: "call-b",
      operationKey: "shared-op-key",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 10,
      grants: [sharedGrant],
    });
    expect(retry).toEqual({ grantId: "grant-retry-shared", reused: true });
    expect(db.rows).toHaveLength(1);
  });

  it("releases unsent refusals (including operationKey) for retry while holding UNKNOWN outcomes permanently", async () => {
    const db = createInMemorySpendDb();
    const grant: MediaSpendGrant = {
      grantId: "grant-lifecycle",
      images: 1,
      maxMediaCredits: 10,
      targetScope: { kind: "workspace" },
    };

    await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "wake-1",
      toolCallId: "call-1",
      operationKey: "op-same-input",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 10,
      grants: [grant],
    });
    // Confirmed unsent failure releases both quota and operationKey.
    await settleAuthoritySpend(
      db as never,
      { turnId: "wake-1", toolCallId: "call-1" },
      "RELEASED",
    );
    expect(db.rows[0]).toMatchObject({
      status: AUTHORITY_SPEND_STATUS.RELEASED,
      operationKey: null,
    });

    // Retrying with a new toolCallId and the SAME operationKey now succeeds.
    await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "wake-1",
      toolCallId: "call-2",
      operationKey: "op-same-input",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 10,
      grants: [grant],
    });
    // Ambiguous provider failure leaves the reservation held as UNKNOWN.
    await settleAuthoritySpend(
      db as never,
      { turnId: "wake-1", toolCallId: "call-2" },
      "UNKNOWN",
    );
    expect(db.rows[1]).toMatchObject({
      status: AUTHORITY_SPEND_STATUS.UNKNOWN,
      operationKey: "op-same-input",
    });

    // A fresh attempt cannot double-spend past the held UNKNOWN reservation.
    await expect(
      reserveAuthoritySpend(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "wake-1",
        toolCallId: "call-3",
        operationKey: "op-new-input",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 10,
        grants: [grant],
      }),
    ).rejects.toThrow("The owner asked for 1 image in this plan");
  });

  it("charges each item in a mixed wake to its own grantId without cross-grant double counting and locks grants in sorted order", async () => {
    const db = createInMemorySpendDb();
    const grantB: MediaSpendGrant = {
      grantId: "grant-b",
      images: 1,
      maxMediaCredits: 10,
      targetScope: { kind: "workspace" },
      legacyTurnIds: ["mixed-wake"],
    };
    const grantA: MediaSpendGrant = {
      grantId: "grant-a",
      images: 2,
      maxMediaCredits: 20,
      targetScope: { kind: "workspace" },
      legacyTurnIds: ["mixed-wake"],
    };

    // Pass unsorted [grantB, grantA] and verify advisory locks acquire sorted order.
    const r1 = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "mixed-wake",
      toolCallId: "c1",
      operationKey: "op-1",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 10,
      grants: [grantB, grantA],
    });
    expect(r1?.grantId).toBe("grant-a");
    expect(db.lockedKeys).toEqual([
      `soko-bot-authority-spend:${BOT_ID}:grant-a`,
      `soko-bot-authority-spend:${BOT_ID}:grant-b`,
    ]);
    // Also record the corresponding sokoBotToolCall (as production does) to prove
    // grant-b does NOT double-count grant-a's tracked call via legacy fallback.
    db.legacyCalls.push({
      turnId: "mixed-wake",
      toolCallId: "c1",
      capability: "generate_image",
      disposition: "APPLIED",
      input: { maxCredits: 10 },
    });

    const r2 = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "mixed-wake",
      toolCallId: "c2",
      operationKey: "op-2",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 10,
      grants: [grantB, grantA],
    });
    expect(r2?.grantId).toBe("grant-a");
    db.legacyCalls.push({
      turnId: "mixed-wake",
      toolCallId: "c2",
      capability: "generate_image",
      disposition: "APPLIED",
      input: { maxCredits: 10 },
    });

    // grant-a is now full (2/2), so the 3rd image charges grant-b (0/1 -> 1/1).
    const r3 = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "mixed-wake",
      toolCallId: "c3",
      operationKey: "op-3",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 10,
      grants: [grantB, grantA],
    });
    expect(r3?.grantId).toBe("grant-b");

    // 4th image is refused because both grants are exhausted.
    await expect(
      reserveAuthoritySpend(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "mixed-wake",
        toolCallId: "c4",
        operationKey: "op-4",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 5,
        grants: [grantB, grantA],
      }),
    ).rejects.toThrow("The owner asked for 2 images in this plan");
  });

  it("enforces project targetScope isolation and counts pre-migration legacy tool calls on retry", async () => {
    const db = createInMemorySpendDb();
    const projectGrant: MediaSpendGrant = {
      grantId: "grant-project-a",
      images: 2,
      maxMediaCredits: 20,
      targetScope: { kind: "project", projectId: PROJECT_A },
      legacyTurnIds: ["pre-migration-failed-turn", "retry-turn"],
    };

    // Wrong project is rejected at preflight before dispatch.
    await expect(
      checkGrantSpendPreflight(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "retry-turn",
        toolCallId: "c1",
        operationKey: "op-wrong-proj",
        capability: "generate_image",
        projectId: PROJECT_B,
        images: 1,
        videos: 0,
        credits: 10,
        grants: [projectGrant],
      }),
    ).rejects.toThrow("scoped to a different Project");

    // Seed a pre-migration tool call (no SokoBotAuthoritySpend row) on the failed turn.
    db.legacyCalls.push({
      turnId: "pre-migration-failed-turn",
      toolCallId: "legacy-1",
      capability: "generate_image",
      disposition: "APPLIED",
      input: { maxCredits: 15 },
    });

    // 10 credits would exceed 20 (15 already spent by pre-migration worker).
    await expect(
      checkGrantSpendPreflight(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "retry-turn",
        toolCallId: "c2",
        operationKey: "op-over-legacy",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 10,
        grants: [projectGrant],
      }),
    ).rejects.toThrow(
      "The owner allowed 20 credits on media for this plan, and 15 are set aside already",
    );

    // 5 credits fits within remaining budget.
    await expect(
      checkGrantSpendPreflight(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "retry-turn",
        toolCallId: "c2",
        operationKey: "op-fits-legacy",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 5,
        grants: [projectGrant],
      }),
    ).resolves.toBeUndefined();
  });
});
