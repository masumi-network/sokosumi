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
  operationKey?: string | null;
  capability: string;
  status?: string;
  disposition: string | null;
  replayedReceiptId?: string | null;
  input: { maxCredits: number; projectId?: string };
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
          turnId?: { in: string[] };
          toolCallId?: { in: string[] };
          capability?: { in: string[] };
          disposition?: string;
          replayedReceiptId?: null;
          NOT?: { turnId?: string; toolCallId?: string };
        };
      }) =>
        legacyCalls.filter(
          (call) =>
            (!where.turnId || where.turnId.in.includes(call.turnId)) &&
            (!where.toolCallId ||
              where.toolCallId.in.includes(call.toolCallId)) &&
            (!where.capability ||
              where.capability.in.includes(call.capability)) &&
            (where.disposition !== undefined
              ? call.disposition === where.disposition
              : call.disposition !== "REJECTED") &&
            (where.replayedReceiptId === null
              ? call.replayedReceiptId == null
              : true) &&
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

  it("ignores ALREADY_SATISFIED replay markers so a replayed image never charges the grant twice", async () => {
    const db = createInMemorySpendDb();
    const grant: MediaSpendGrant = {
      grantId: "grant-replay-marker",
      images: 2,
      maxMediaCredits: 20,
      targetScope: { kind: "workspace" },
      legacyTurnIds: ["wake-1"],
    };

    // First image settled in ledger (10 credits) + tool-call row.
    await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "wake-1",
      toolCallId: "orig-1",
      operationKey: "op-img-1",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 10,
      grants: [grant],
    });
    await settleAuthoritySpend(
      db as never,
      { turnId: "wake-1", toolCallId: "orig-1" },
      "SETTLED",
    );
    db.legacyCalls.push(
      {
        turnId: "wake-1",
        toolCallId: "orig-1",
        operationKey: "op-img-1",
        capability: "generate_image",
        disposition: "APPLIED",
        replayedReceiptId: null,
        input: { maxCredits: 10 },
      },
      // Replay marker written by execution.ts on a second toolCallId: NOT a second job.
      {
        turnId: "wake-1",
        toolCallId: "replay-1",
        operationKey: null,
        capability: "generate_image",
        disposition: "ALREADY_SATISFIED",
        replayedReceiptId: "receipt-orig-1",
        input: { maxCredits: 10 },
      },
    );

    // Second distinct 10-credit image MUST pass preflight and reserve (total 2/2 images, 20/20 credits).
    await expect(
      checkGrantSpendPreflight(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "wake-1",
        toolCallId: "img-2",
        operationKey: "op-img-2",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 10,
        grants: [grant],
      }),
    ).resolves.toBeUndefined();
    const second = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "wake-1",
      toolCallId: "img-2",
      operationKey: "op-img-2",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 10,
      grants: [grant],
    });
    expect(second).toEqual({ grantId: "grant-replay-marker", reused: false });

    // Third image is refused.
    await expect(
      reserveAuthoritySpend(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "wake-1",
        toolCallId: "img-3",
        operationKey: "op-img-3",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 5,
        grants: [grant],
      }),
    ).rejects.toThrow("The owner asked for 2 images in this plan");
  });

  it("counts each pre-migration historical paid call once across multiple old grants sharing a wake", async () => {
    const db = createInMemorySpendDb();
    const legacyA: MediaSpendGrant = {
      grantId: "legacy-delegation:a",
      images: 1,
      maxMediaCredits: 10,
      targetScope: { kind: "workspace" },
      legacyTurnIds: ["old-failed-wake", "retry-wake"],
    };
    const legacyB: MediaSpendGrant = {
      grantId: "legacy-delegation:b",
      images: 1,
      maxMediaCredits: 10,
      targetScope: { kind: "workspace" },
      legacyTurnIds: ["old-failed-wake", "retry-wake"],
    };

    // One historical paid image on the pre-migration failed wake (no ledger row).
    db.legacyCalls.push({
      turnId: "old-failed-wake",
      toolCallId: "legacy-img-1",
      capability: "generate_image",
      disposition: "APPLIED",
      replayedReceiptId: null,
      input: { maxCredits: 10 },
    });

    // Both grants are identical (1 image, 10 credits each): the historical call
    // consumes one grant and the new 2nd image reserves the other cleanly.
    const second = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "retry-wake",
      toolCallId: "new-img-2",
      operationKey: "op-new-2",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 10,
      grants: [legacyA, legacyB],
    });
    expect(second).toEqual({ grantId: "legacy-delegation:a", reused: false });

    // A 3rd image exhausts both old grants and is refused.
    await expect(
      reserveAuthoritySpend(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "retry-wake",
        toolCallId: "new-img-3",
        operationKey: "op-new-3",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 5,
        grants: [legacyA, legacyB],
      }),
    ).rejects.toThrow("The owner asked for 1 image in this plan");
  });

  it("ignores and repairs stranded RESERVED rows whose durable tool-call receipt is REJECTED while keeping in-flight or UNKNOWN rows held", async () => {
    const db = createInMemorySpendDb();
    const grant: MediaSpendGrant = {
      grantId: "grant-stranded",
      images: 1,
      maxMediaCredits: 10,
      targetScope: { kind: "workspace" },
    };

    // Simulate a crash between committing a REJECTED receipt and releasing spend.
    db.rows.push({
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      grantId: grant.grantId,
      operationKey: "op-refunded",
      turnId: "wake-1",
      toolCallId: "call-refunded",
      capability: "generate_image",
      images: 1,
      videos: 0,
      credits: 10,
      status: AUTHORITY_SPEND_STATUS.RESERVED,
    });
    db.legacyCalls.push({
      turnId: "wake-1",
      toolCallId: "call-refunded",
      operationKey: null,
      capability: "generate_image",
      status: "COMPLETED",
      disposition: "REJECTED",
      input: { maxCredits: 10, projectId: PROJECT_A },
    });

    // Preflight sees the stranded row as released and permits a corrected retry.
    await expect(
      checkGrantSpendPreflight(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "wake-1",
        toolCallId: "call-corrected",
        operationKey: "op-refunded",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 10,
        grants: [grant],
      }),
    ).resolves.toBeUndefined();

    // Reserving with the SAME operationKey repairs the stranded row (releasing
    // its unique operationKey) and reserves the corrected call cleanly.
    const reserved = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "wake-1",
      toolCallId: "call-corrected",
      operationKey: "op-refunded",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 10,
      grants: [grant],
    });
    expect(reserved).toEqual({ grantId: grant.grantId, reused: false });
    expect(db.rows[0]).toMatchObject({
      toolCallId: "call-refunded",
      status: AUTHORITY_SPEND_STATUS.RELEASED,
      operationKey: null,
    });
    expect(db.rows[1]).toMatchObject({
      toolCallId: "call-corrected",
      status: AUTHORITY_SPEND_STATUS.RESERVED,
      operationKey: "op-refunded",
    });

    // By contrast, an in-flight PENDING+UNKNOWN call stays held and blocks another image.
    db.legacyCalls.push({
      turnId: "wake-1",
      toolCallId: "call-corrected",
      operationKey: "op-refunded",
      capability: "generate_image",
      status: "PENDING",
      disposition: "UNKNOWN",
      input: { maxCredits: 10, projectId: PROJECT_A },
    });
    await expect(
      reserveAuthoritySpend(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "wake-1",
        toolCallId: "call-third",
        operationKey: "op-other",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 5,
        grants: [grant],
      }),
    ).rejects.toThrow("The owner asked for 1 image in this plan");
  });

  it("attributes historical Project A spend before filtering so Project B keeps its untouched grant", async () => {
    const db = createInMemorySpendDb();
    const grantA: MediaSpendGrant = {
      grantId: "grant-proj-a",
      images: 1,
      maxMediaCredits: 5,
      targetScope: { kind: "project", projectId: PROJECT_A },
      legacyTurnIds: ["mixed-wake"],
    };
    const grantB: MediaSpendGrant = {
      grantId: "grant-proj-b",
      images: 1,
      maxMediaCredits: 5,
      targetScope: { kind: "project", projectId: PROJECT_B },
      legacyTurnIds: ["mixed-wake"],
    };

    // Historical 5-credit image spent on Project A.
    db.legacyCalls.push({
      turnId: "mixed-wake",
      toolCallId: "legacy-proj-a",
      capability: "generate_image",
      disposition: "APPLIED",
      replayedReceiptId: null,
      input: { maxCredits: 5, projectId: PROJECT_A },
    });

    // Project B's untouched 5-credit grant passes preflight and reserves cleanly,
    // whether both grants or only Project B's grant are passed.
    await expect(
      checkGrantSpendPreflight(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "mixed-wake",
        toolCallId: "new-proj-b",
        operationKey: "op-proj-b",
        capability: "generate_image",
        projectId: PROJECT_B,
        images: 1,
        videos: 0,
        credits: 5,
        grants: [grantB],
      }),
    ).resolves.toBeUndefined();

    const reservedB = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "mixed-wake",
      toolCallId: "new-proj-b",
      operationKey: "op-proj-b",
      capability: "generate_image",
      projectId: PROJECT_B,
      images: 1,
      videos: 0,
      credits: 5,
      grants: [grantA, grantB],
    });
    expect(reservedB).toEqual({ grantId: "grant-proj-b", reused: false });

    // Project A's grant IS exhausted by the historical Project A image.
    await expect(
      reserveAuthoritySpend(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "mixed-wake",
        toolCallId: "new-proj-a-2",
        operationKey: "op-proj-a-2",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 5,
        grants: [grantA, grantB],
      }),
    ).rejects.toThrow("The owner asked for 1 image in this plan");

    // Mixed Project A + workspace grant: Project A historical call binds to
    // grantA so the workspace grant remains free for Project B.
    const dbMixedWs = createInMemorySpendDb();
    dbMixedWs.legacyCalls.push({
      turnId: "mixed-ws-wake",
      toolCallId: "legacy-proj-a",
      capability: "generate_image",
      disposition: "APPLIED",
      replayedReceiptId: null,
      input: { maxCredits: 5, projectId: PROJECT_A },
    });
    const grantWs: MediaSpendGrant = {
      grantId: "grant-ws",
      images: 1,
      maxMediaCredits: 5,
      targetScope: { kind: "workspace" },
      legacyTurnIds: ["mixed-ws-wake"],
    };
    const reservedWs = await reserveAuthoritySpend(dbMixedWs as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "mixed-ws-wake",
      toolCallId: "new-proj-b",
      operationKey: "op-ws-proj-b",
      capability: "generate_image",
      projectId: PROJECT_B,
      images: 1,
      videos: 0,
      credits: 5,
      grants: [{ ...grantA, legacyTurnIds: ["mixed-ws-wake"] }, grantWs],
    });
    expect(reservedWs).toEqual({ grantId: "grant-ws", reused: false });
  });

  it("preserves feasible allocations across differently sized legacy workspace grants (10 cr + 5 cr with a past 5 cr image)", async () => {
    const db = createInMemorySpendDb();
    // Deliberately put the 10-credit grant first alphabetically so greedy
    // assignment would misplace the past 5-credit image onto the 10-credit grant.
    const grantTen: MediaSpendGrant = {
      grantId: "grant-a-ten",
      images: 1,
      maxMediaCredits: 10,
      targetScope: { kind: "workspace" },
      legacyTurnIds: ["shared-wake"],
    };
    const grantFive: MediaSpendGrant = {
      grantId: "grant-b-five",
      images: 1,
      maxMediaCredits: 5,
      targetScope: { kind: "workspace" },
      legacyTurnIds: ["shared-wake"],
    };

    db.legacyCalls.push({
      turnId: "shared-wake",
      toolCallId: "past-five",
      capability: "generate_image",
      disposition: "APPLIED",
      replayedReceiptId: null,
      input: { maxCredits: 5, projectId: PROJECT_A },
    });

    // A new 10-credit image fits by placing the past 5-credit image on grantFive
    // and reserving the new 10-credit image on grantTen.
    await expect(
      checkGrantSpendPreflight(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "shared-wake",
        toolCallId: "new-ten",
        operationKey: "op-new-ten",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 10,
        grants: [grantTen, grantFive],
      }),
    ).resolves.toBeUndefined();

    const reservedTen = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "shared-wake",
      toolCallId: "new-ten",
      operationKey: "op-new-ten",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 10,
      grants: [grantTen, grantFive],
    });
    expect(reservedTen).toEqual({ grantId: "grant-a-ten", reused: false });

    // Both grants are now accounted for (grantTen by ledger, grantFive by past-five),
    // so a 3rd image is refused.
    await expect(
      reserveAuthoritySpend(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "shared-wake",
        toolCallId: "third-img",
        operationKey: "op-third",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 1,
        grants: [grantTen, grantFive],
      }),
    ).rejects.toThrow("The owner asked for 1 image in this plan");
  });

  it("enforces fractional credit caps accurately (e.g. 5.5 credits across two 2.75-credit images)", async () => {
    const db = createInMemorySpendDb();
    const fractionalAuth = makeDelegationAuthority({
      grantId: "grant-fractional",
      images: 2,
      maxMediaCredits: 5.5,
    });
    const summarized = summarizeGrantBuckets([{ authority: fractionalAuth }]);
    expect(summarized.grants[0]?.maxMediaCredits).toBe(5.5);

    const r1 = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "wake-frac",
      toolCallId: "frac-1",
      operationKey: "op-frac-1",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 2.75,
      grants: summarized.grants,
    });
    expect(r1).toEqual({ grantId: "grant-fractional", reused: false });
    expect(db.rows[0]?.credits).toBe(2.75);

    // 2.8 exceeds the remaining 2.75 credits on the 5.5-credit allowance.
    await expect(
      checkGrantSpendPreflight(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "wake-frac",
        toolCallId: "frac-over",
        operationKey: "op-frac-over",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 2.8,
        grants: summarized.grants,
      }),
    ).rejects.toThrow(
      "The owner allowed 5.5 credits on media for this plan, and 2.75 are set aside already",
    );

    // Exact remaining 2.75 fits (total 5.5 / 5.5).
    const r2 = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "wake-frac",
      toolCallId: "frac-2",
      operationKey: "op-frac-2",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 2.75,
      grants: summarized.grants,
    });
    expect(r2).toEqual({ grantId: "grant-fractional", reused: false });
    expect(db.rows[1]?.credits).toBe(2.75);
  });

  it("retains both Projects when one shared grantId authorizes Project A and Project B in either row order", async () => {
    const PROJECT_C = "0193a000-0000-7000-8000-0000000000cc";
    const authA = makeDelegationAuthority({
      grantId: "shared-two-proj-grant",
      images: 2,
      maxMediaCredits: 10,
      projectId: PROJECT_A,
    });
    const authB = makeDelegationAuthority({
      grantId: "shared-two-proj-grant",
      images: 2,
      maxMediaCredits: 10,
      projectId: PROJECT_B,
    });

    const summarizedAB = summarizeGrantBuckets([
      { authority: authA },
      { authority: authB },
    ]);
    const summarizedBA = summarizeGrantBuckets([
      { authority: authB },
      { authority: authA },
    ]);
    expect(summarizedAB).toEqual(summarizedBA);
    expect(summarizedAB.grants).toHaveLength(1);
    expect(summarizedAB.grants[0]?.allowedProjectIds).toEqual([
      PROJECT_A,
      PROJECT_B,
    ]);

    for (const summarized of [summarizedAB, summarizedBA]) {
      const db = createInMemorySpendDb();
      // First 5-credit image on Project B succeeds in both [A,B] and [B,A] order.
      const firstB = await reserveAuthoritySpend(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "shared-proj-wake",
        toolCallId: "img-b-1",
        operationKey: "op-b-1",
        capability: "generate_image",
        projectId: PROJECT_B,
        images: 1,
        videos: 0,
        credits: 5,
        grants: summarized.grants,
      });
      expect(firstB).toEqual({
        grantId: "shared-two-proj-grant",
        reused: false,
      });
      await settleAuthoritySpend(
        db as never,
        { turnId: "shared-proj-wake", toolCallId: "img-b-1" },
        "SETTLED",
      );

      // Second legitimate 5-credit image on Project A shares the same grant balance.
      const secondA = await reserveAuthoritySpend(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "shared-proj-wake",
        toolCallId: "img-a-2",
        operationKey: "op-a-2",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 5,
        grants: summarized.grants,
      });
      expect(secondA).toEqual({
        grantId: "shared-two-proj-grant",
        reused: false,
      });

      // Third image exhausts the shared 2-image balance.
      await expect(
        reserveAuthoritySpend(db as never, {
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          turnId: "shared-proj-wake",
          toolCallId: "img-b-3",
          operationKey: "op-b-3",
          capability: "generate_image",
          projectId: PROJECT_B,
          images: 1,
          videos: 0,
          credits: 1,
          grants: summarized.grants,
        }),
      ).rejects.toThrow("The owner asked for 2 images in this plan");

      // An unauthorized Project C is still refused.
      await expect(
        checkGrantSpendPreflight(db as never, {
          sokoBotId: BOT_ID,
          workspaceId: WS_ID,
          turnId: "shared-proj-wake",
          toolCallId: "img-c",
          operationKey: "op-c",
          capability: "generate_image",
          projectId: PROJECT_C,
          images: 1,
          videos: 0,
          credits: 1,
          grants: summarized.grants,
        }),
      ).rejects.toThrow("scoped to a different Project");
    }
  });

  it("preserves pooled credit accounting for an already-incurred pre-migration image spanning two 5-credit legacy grants", async () => {
    const db = createInMemorySpendDb();
    const legacyA: MediaSpendGrant = {
      grantId: "legacy-delegation:a",
      images: 1,
      maxMediaCredits: 5,
      targetScope: { kind: "workspace" },
      legacyTurnIds: ["pooled-old-wake"],
    };
    const legacyB: MediaSpendGrant = {
      grantId: "legacy-delegation:b",
      images: 1,
      maxMediaCredits: 5,
      targetScope: { kind: "workspace" },
      legacyTurnIds: ["pooled-old-wake"],
    };

    // Under the pre-migration pooled rules (2 images, 10 credits total), a
    // 7-credit image legitimately ran, leaving 1 image and 3 credits.
    db.legacyCalls.push({
      turnId: "pooled-old-wake",
      toolCallId: "legacy-seven",
      capability: "generate_image",
      disposition: "APPLIED",
      replayedReceiptId: null,
      input: { maxCredits: 7, projectId: PROJECT_A },
    });

    // A 4-credit image exceeds the remaining 3 pooled credits and is refused.
    await expect(
      checkGrantSpendPreflight(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "pooled-old-wake",
        toolCallId: "new-four",
        operationKey: "op-four",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 4,
        grants: [legacyA, legacyB],
      }),
    ).rejects.toThrow();

    // A 3-credit image fits the remaining 1 image & 3 credits and reserves cleanly.
    await expect(
      checkGrantSpendPreflight(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "pooled-old-wake",
        toolCallId: "new-three",
        operationKey: "op-three",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 3,
        grants: [legacyA, legacyB],
      }),
    ).resolves.toBeUndefined();

    const reservedThree = await reserveAuthoritySpend(db as never, {
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      turnId: "pooled-old-wake",
      toolCallId: "new-three",
      operationKey: "op-three",
      capability: "generate_image",
      projectId: PROJECT_A,
      images: 1,
      videos: 0,
      credits: 3,
      grants: [legacyA, legacyB],
    });
    expect(reservedThree?.reused).toBe(false);

    // A 3rd image is refused because both image slots and all 10 credits are spent.
    await expect(
      reserveAuthoritySpend(db as never, {
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        turnId: "pooled-old-wake",
        toolCallId: "new-third",
        operationKey: "op-third",
        capability: "generate_image",
        projectId: PROJECT_A,
        images: 1,
        videos: 0,
        credits: 1,
        grants: [legacyA, legacyB],
      }),
    ).rejects.toThrow();
  });
});
