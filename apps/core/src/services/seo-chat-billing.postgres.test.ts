import { randomUUID } from "node:crypto";
import { convertCreditsToCents } from "@sokosumi/utils";
import { afterAll, describe, expect, it, vi } from "vitest";
import { mapTransactionHistoryRow } from "@/helpers/transaction-history";
import { findTransactionHistoryPage } from "@/lib/credits/history";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { createSeoAudit } from "./seo-audit.service";
import { listSeoChat, sendSeoChat } from "./seo-chat.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const users: string[] = [];
const organizations: string[] = [];
const modelReply = {
  text: JSON.stringify({ reply: "Review this page.", actions: [] }),
  costUsd: 0.001234,
  usage: { inputTokens: 123, outputTokens: 45, costUsd: 0.001234 },
};
const input = () => ({
  question: "What should I check?",
  idempotencyKey: randomUUID(),
});

async function fixture(credits: number, organization = false, project = false) {
  const userId = randomUUID();
  users.push(userId);
  await prisma.user.create({
    data: {
      id: userId,
      name: "SEO chat billing fixture",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const organizationId = organization ? randomUUID() : null;
  const workspaceId = randomUUID();
  if (organizationId) {
    organizations.push(organizationId);
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "SEO chat billing organization",
        slug: organizationId,
        workspace: { create: { id: workspaceId } },
        members: {
          create: { userId, role: "owner", seatAssignedAt: new Date() },
        },
      },
    });
  } else {
    await prisma.workspace.create({ data: { id: workspaceId, userId } });
  }
  const base = { userId, organizationId, workspaceId };
  const audit = await createSeoAudit(base, {
    name: "Billed SEO audit",
    firstPage: { url: "https://example.test/billing", relationship: "primary" },
  });
  if (!audit.auditId) throw new Error("Missing fixture audit");
  let projectId: string | null = null;
  if (project) {
    const row = await prisma.project.create({
      data: {
        name: "SEO billing Project",
        workspaceId,
      },
    });
    projectId = row.id;
    await prisma.seoAudit.update({
      where: { id: audit.auditId },
      data: { projectId },
    });
  }
  const bucket = await prisma.creditBucket.create({
    data: {
      ...(organizationId
        ? { organization: { connect: { id: organizationId } } }
        : { user: { connect: { id: userId } } }),
      ...(projectId ? { project: { connect: { id: projectId } } } : {}),
      amount: convertCreditsToCents(credits),
      sourceTransaction: {
        create: {
          userId,
          organizationId,
          amount: convertCreditsToCents(credits),
        },
      },
    },
  });
  const actor: SeoActor = {
    ...base,
    owner: { kind: "audit", id: audit.auditId },
  };
  return { actor, bucket, projectId };
}

describe.skipIf(!enabled)("SEO chat usage charges on PostgreSQL", () => {
  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: organizations } },
    });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it("refuses an unfunded turn before inference", async () => {
    const { actor } = await fixture(0);
    const generate = vi.fn(async () => modelReply);
    await expect(
      sendSeoChat(actor, input(), { generate }),
    ).rejects.toMatchObject({ status: 422 });
    expect(generate).not.toHaveBeenCalled();
    expect(
      await prisma.seoAuditChatTurn.count({
        where: { auditId: actor.owner.id },
      }),
    ).toBe(0);
  });

  it.each([
    [false, false],
    [true, false],
    [true, true],
  ])(
    "charges exact fractional usage once to the right wallet (organization=%s, project=%s)",
    async (organization, project) => {
      const { actor, bucket, projectId } = await fixture(
        1,
        organization,
        project,
      );
      // An unrelated wallet must never fund this reply.
      await prisma.creditBucket.create({
        data: {
          user: { connect: { id: actor.userId } },
          amount: convertCreditsToCents(10),
          sourceTransaction: {
            create: { userId: actor.userId, amount: convertCreditsToCents(10) },
          },
        },
      });
      const request = input();
      const generate = vi.fn(async () => modelReply);
      const first = await sendSeoChat(actor, request, { generate });
      expect(first.creditsCharged).toBe(0.1234);
      await prisma.creditBucket.update({
        where: { id: bucket.id },
        data: { amount: convertCreditsToCents(0.1234) },
      });
      expect(
        (await sendSeoChat(actor, request, { generate })).creditsCharged,
      ).toBe(0.1234);
      expect(generate).toHaveBeenCalledTimes(1);
      const turn = await prisma.seoAuditChatTurn.findUniqueOrThrow({
        where: { id: first.id },
        include: { transaction: { include: { creditConsumptions: true } } },
      });
      expect(turn.usage).toEqual({
        ...modelReply.usage,
        billing: { projectId },
      });
      expect(turn.transaction).toMatchObject({
        userId: actor.userId,
        organizationId: actor.organizationId,
        amount: -convertCreditsToCents(0.1234),
        creditConsumptions: [
          { bucketId: bucket.id, amount: convertCreditsToCents(0.1234) },
        ],
      });
    },
  );

  it("replays an in-flight request without a second model call or charge", async () => {
    const { actor } = await fixture(1);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = vi.fn(async () => {
      entered();
      await wait;
      return modelReply;
    });
    const request = input();
    const pending = sendSeoChat(actor, request, { generate });
    await started;
    try {
      const replay = await sendSeoChat(actor, request, { generate });
      expect(replay.status).toBe("running");
      expect(replay.creditsCharged).toBeNull();
    } finally {
      release();
    }
    const result = await pending;
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await listSeoChat(actor)).turns).toHaveLength(1);
    expect(result.creditsCharged).toBe(0.1234);
  });

  it("rolls back the reply and debit when credits disappear during inference", async () => {
    const { actor, bucket } = await fixture(0.1);
    const request = input();
    await expect(
      sendSeoChat(actor, request, {
        generate: async () => {
          await prisma.creditBucket.update({
            where: { id: bucket.id },
            data: { amount: 0n },
          });
          return modelReply;
        },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(
      await prisma.seoAuditChatTurn.findFirst({
        where: { auditId: actor.owner.id },
      }),
    ).toMatchObject({
      status: "failed",
      response: null,
      transactionId: null,
      costUsd: modelReply.costUsd,
    });
    expect(
      await prisma.transaction.count({
        where: { userId: actor.userId, amount: { lt: 0n } },
      }),
    ).toBe(0);
  });

  it("bills the minimum for an explicitly zero-priced completed call", async () => {
    const { actor } = await fixture(1);
    const result = await sendSeoChat(actor, input(), {
      generate: async () => ({ ...modelReply, costUsd: 0 }),
    });
    expect(result.creditsCharged).toBe(0.1);
  });

  it("settles only one of two concurrent replies competing for the same credits", async () => {
    const { actor } = await fixture(0.2);
    const other = await createSeoAudit(actor, {
      name: "Competing audit",
      firstPage: { url: "https://example.test/other", relationship: "primary" },
    });
    if (!other.auditId) throw new Error("Missing competing audit");
    let entered = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = async () => {
      entered += 1;
      if (entered === 2) release();
      await ready;
      return modelReply;
    };
    const results = await Promise.allSettled([
      sendSeoChat(actor, input(), { generate }),
      sendSeoChat(
        { ...actor, owner: { kind: "audit", id: other.auditId } },
        input(),
        { generate },
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { status: 422 } });
    expect(
      await prisma.transaction.count({
        where: { userId: actor.userId, amount: { lt: 0n } },
      }),
    ).toBe(1);
  });

  it("keeps the original Project payer when the audit is relinked during inference", async () => {
    const { actor, bucket } = await fixture(1, true, true);
    const other = await prisma.project.create({
      data: { workspaceId: actor.workspaceId, name: "Relinked Project" },
    });
    const result = await sendSeoChat(actor, input(), {
      generate: async () => {
        await prisma.seoAudit.update({
          where: { id: actor.owner.id },
          data: { projectId: other.id },
        });
        return modelReply;
      },
    });
    const turn = await prisma.seoAuditChatTurn.findUniqueOrThrow({
      where: { id: result.id },
      include: { transaction: { include: { creditConsumptions: true } } },
    });
    expect(turn.transaction?.creditConsumptions).toMatchObject([
      { bucketId: bucket.id, amount: convertCreditsToCents(0.1234) },
    ]);
  });

  it("attributes pooled Project chat spending to its frozen Project without exposing the conversation", async () => {
    const { actor, bucket, projectId } = await fixture(1, true, true);
    if (!projectId) throw new Error("Missing billing Project");
    // Spend the Organization pool while retaining the approved Project context.
    await prisma.creditBucket.update({
      where: { id: bucket.id },
      data: { projectId: null },
    });
    const result = await sendSeoChat(actor, input(), {
      generate: async () => modelReply,
    });
    await prisma.seoAudit.update({
      where: { id: actor.owner.id },
      data: { projectId: null },
    });
    const history = await findTransactionHistoryPage(
      {
        billingScope: createNetworkScope("mainnet"),
        scope: "workspace",
        kinds: ["seoChat"],
        projectId,
        userContext: {
          source: "context",
          userId: actor.userId,
          organizationId: actor.organizationId,
        },
        workspaceContext: {
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          organizationId: actor.organizationId,
        },
      },
      { take: 20 },
      prisma,
    );
    expect(history.rows).toHaveLength(1);
    expect(mapTransactionHistoryRow(history.rows[0]!)).toMatchObject({
      kind: "seoChat",
      title: "SEO chat",
      description: null,
      projectId,
      credits: result.creditsCharged,
    });
    expect(
      JSON.stringify(mapTransactionHistoryRow(history.rows[0]!)),
    ).not.toContain(modelReply.text);
  });

  it("does not charge invalid, expired or revoked replies", async () => {
    for (const failure of ["invalid", "expired", "revoked"] as const) {
      const { actor } = await fixture(1, failure === "revoked");
      await expect(
        sendSeoChat(actor, input(), {
          generate: async () => {
            if (failure === "expired")
              await prisma.seoAuditChatTurn.updateMany({
                where: { auditId: actor.owner.id },
                data: { leaseExpiresAt: new Date(0) },
              });
            if (failure === "revoked")
              await prisma.member.deleteMany({
                where: {
                  userId: actor.userId,
                  organizationId: actor.organizationId!,
                },
              });
            return failure === "invalid"
              ? { ...modelReply, text: "unusable" }
              : modelReply;
          },
        }),
      ).rejects.toThrow();
      expect(
        await prisma.seoAuditChatTurn.findFirst({
          where: { auditId: actor.owner.id },
        }),
      ).toMatchObject({
        status: "failed",
        response: null,
        transactionId: null,
        costUsd: modelReply.costUsd,
      });
      expect(
        await prisma.transaction.count({
          where: { userId: actor.userId, amount: { lt: 0n } },
        }),
      ).toBe(0);
    }
  });
});
