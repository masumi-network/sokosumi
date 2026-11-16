import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { createSeoAudit } from "./seo-audit.service";
import { sendSeoChat } from "./seo-chat.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const originalLimit = getEnv().SEO_CHAT_DAILY_TURN_LIMIT;
const createdUsers: string[] = [];
const createdOrganizations: string[] = [];
const modelReply = {
  text: JSON.stringify({ reply: "Review the saved page.", actions: [] }),
  costUsd: 0.01,
};
const firstPage = {
  url: "https://example.test/quota",
  relationship: "primary" as const,
};
function input() {
  return { question: "What should I check?", idempotencyKey: randomUUID() };
}
async function createUser() {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: "SEO chat allowance fixture",
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  createdUsers.push(id);
  return id;
}
async function createFixture() {
  const userId = await createUser(),
    workspaceId = randomUUID();
  await prisma.workspace.create({ data: { id: workspaceId, userId } });
  const base = { userId, workspaceId, organizationId: null };
  const actors: SeoActor[] = [];
  for (const name of ["First Audit", "Second Audit", "Saved attempts"]) {
    const audit = await createSeoAudit(base, { name, firstPage });
    if (!audit.auditId) throw new Error("Expected an Audit identity");
    actors.push({ ...base, owner: { kind: "audit", id: audit.auditId } });
  }
  return { base, actors };
}
async function seedTurn(
  actor: SeoActor,
  status: string,
  createdAt = new Date(),
) {
  return prisma.seoAuditChatTurn.create({
    data: {
      auditId: actor.owner.id,
      userId: actor.userId,
      idempotencyKey: randomUUID(),
      requestHash: "saved-attempt",
      question: "Saved attempt",
      response: status === "completed" ? "Saved reply" : null,
      status,
      model: "injected-test-model",
      scopeSnapshot: {
        name: "All pages",
        pageIds: [],
        scopeId: null,
        version: 0,
        from: null,
        to: null,
      },
      createdAt,
      leaseExpiresAt: new Date(createdAt.getTime() - 1),
    },
  });
}

describe.skipIf(!enabled)("Atomic native SEO chat daily allowance", () => {
  afterEach(() => {
    getEnv().SEO_CHAT_DAILY_TURN_LIMIT = originalLimit;
  });
  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: createdOrganizations } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    await prisma.$disconnect();
  });

  it("admits one concurrent request across different Audits at the final daily slot", async () => {
    const { base, actors } = await createFixture();
    getEnv().SEO_CHAT_DAILY_TURN_LIMIT = 4;
    for (const status of ["completed", "failed", "running"])
      await seedTurn(actors[2], status);
    const generate = vi.fn(async () => modelReply);
    const results = await Promise.allSettled([
      sendSeoChat(actors[0], input(), { generate }),
      sendSeoChat(actors[1], input(), { generate }),
    ]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(results.find((row) => row.status === "rejected")).toMatchObject({
      reason: { status: 429 },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      await prisma.seoAuditChatTurn.count({
        where: {
          userId: base.userId,
          audit: { workspaceId: base.workspaceId },
        },
      }),
    ).toBe(4);
  });

  it("counts failed model attempts, permits their replay at the limit and ignores the previous UTC day", async () => {
    const { base, actors } = await createFixture();
    getEnv().SEO_CHAT_DAILY_TURN_LIMIT = 1;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await seedTurn(actors[2], "failed", new Date(today.getTime() - 1));
    const providerError = new Error("Injected provider failure");
    const generate = vi.fn(async () => {
      throw providerError;
    });
    const first = input();
    await expect(sendSeoChat(actors[0], first, { generate })).rejects.toBe(
      providerError,
    );
    expect((await sendSeoChat(actors[0], first, { generate })).status).toBe(
      "failed",
    );
    await expect(
      sendSeoChat(actors[1], input(), { generate }),
    ).rejects.toMatchObject({ status: 429 });
    const newAudit = await createSeoAudit(base, {
      name: "A new collection cannot reset the allowance",
      firstPage,
    });
    if (!newAudit.auditId) throw new Error("Expected an Audit identity");
    await expect(
      sendSeoChat(
        { ...base, owner: { kind: "audit", id: newAudit.auditId } },
        input(),
        { generate },
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      await prisma.seoAuditChatTurn.count({
        where: {
          userId: base.userId,
          audit: { workspaceId: base.workspaceId },
          createdAt: { gte: today },
        },
      }),
    ).toBe(1);
  });

  it("keeps each reader and Workspace allowance independent", async () => {
    const { base, actors } = await createFixture();
    const otherUserId = await createUser(),
      organizationId = randomUUID(),
      workspaceId = randomUUID();
    createdOrganizations.push(organizationId);
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "SEO allowance organization",
        slug: organizationId,
        workspace: { create: { id: workspaceId } },
        members: {
          create: [base.userId, otherUserId].map((userId) => ({
            userId,
            role: "member",
            seatAssignedAt: new Date(),
          })),
        },
      },
    });
    const otherWorkspaceActor = { ...base, workspaceId, organizationId };
    const otherWorkspaceAudit = await createSeoAudit(otherWorkspaceActor, {
      name: "Another Workspace",
      firstPage,
    });
    if (!otherWorkspaceAudit.auditId)
      throw new Error("Expected an Audit identity");
    const owner: SeoActor["owner"] = {
      kind: "audit",
      id: otherWorkspaceAudit.auditId,
    };
    await seedTurn({ ...otherWorkspaceActor, owner }, "completed");
    getEnv().SEO_CHAT_DAILY_TURN_LIMIT = 1;
    const generate = vi.fn(async () => modelReply);
    expect((await sendSeoChat(actors[0], input(), { generate })).status).toBe(
      "completed",
    );
    expect(
      (
        await sendSeoChat(
          { ...otherWorkspaceActor, owner, userId: otherUserId },
          input(),
          { generate },
        )
      ).status,
    ).toBe("completed");
    await expect(
      sendSeoChat({ ...otherWorkspaceActor, owner }, input(), { generate }),
    ).rejects.toMatchObject({ status: 429 });
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
