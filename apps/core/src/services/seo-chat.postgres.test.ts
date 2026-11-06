import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { recordNativeSeoMetrics } from "./project-seo.service";
import { createSeoAudit } from "./seo-audit.service";
import { listSeoChat, sendSeoChat } from "./seo-chat.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const firstUserId = randomUUID(),
  secondUserId = randomUUID(),
  outsideUserId = randomUUID();
const organizationId = randomUUID(),
  workspaceId = randomUUID(),
  outsideWorkspaceId = randomUUID();
const firstActor = { userId: firstUserId, workspaceId, organizationId };
const secondActor = { userId: secondUserId, workspaceId, organizationId };
const outsideActor = {
  userId: outsideUserId,
  workspaceId: outsideWorkspaceId,
  organizationId: null,
};
const pageUrl = "https://example.test/chat";
const modelReply = {
  text: JSON.stringify({ reply: "Review the saved pages.", actions: [] }),
  costUsd: 0.012,
};
function request(question = "What should I check?") {
  return { question, idempotencyKey: randomUUID() };
}
async function createConversation(name: string) {
  const workspace = await createSeoAudit(firstActor, {
    name,
    firstPage: { url: pageUrl, relationship: "primary" },
  });
  if (!workspace.auditId) throw new Error("Expected an independent Audit");
  return {
    workspace,
    actor: {
      ...firstActor,
      owner: { kind: "audit", id: workspace.auditId },
    } satisfies SeoActor,
  };
}

describe.skipIf(!enabled)(
  "Native audit chat with real ownership and storage",
  () => {
    beforeAll(async () => {
      for (const id of [firstUserId, secondUserId, outsideUserId])
        await prisma.user.create({
          data: {
            id,
            name: "Private Audit chat fixture",
            email: `${id}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: "Audit chat test organization",
          slug: organizationId,
          workspace: { create: { id: workspaceId } },
          members: {
            create: [firstUserId, secondUserId].map((userId) => ({
              userId,
              role: "member",
              seatAssignedAt: new Date(),
            })),
          },
        },
      });
      await prisma.workspace.create({
        data: { id: outsideWorkspaceId, userId: outsideUserId },
      });
    });
    afterAll(async () => {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.workspace.deleteMany({ where: { id: outsideWorkspaceId } });
      await prisma.user.deleteMany({
        where: { id: { in: [firstUserId, secondUserId, outsideUserId] } },
      });
      await prisma.$disconnect();
    });

    it("replays the same completed message once and rejects key reuse for another question or scope", async () => {
      const { actor, workspace } = await createConversation("Replay");
      const generate = vi.fn(async () => modelReply);
      const input = request();
      const first = await sendSeoChat(actor, input, { generate });
      expect((await sendSeoChat(actor, input, { generate })).id).toBe(first.id);
      await expect(
        sendSeoChat(
          actor,
          { ...input, question: "A different question" },
          { generate },
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        sendSeoChat(
          actor,
          { ...input, scope: { pageId: workspace.pages[0].id } },
          { generate },
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(
        await prisma.seoAuditChatTurn.count({
          where: { auditId: actor.owner.id },
        }),
      ).toBe(1);
      expect(
        await prisma.seoAuditChatTurn.findUnique({ where: { id: first.id } }),
      ).toMatchObject({ status: "completed", costUsd: modelReply.costUsd });
    });

    it("permits one in-flight message per reader and replays its running state without another model call", async () => {
      const { actor } = await createConversation("In flight");
      let release!: (value: typeof modelReply) => void;
      let entered!: () => void;
      const active = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pending = new Promise<typeof modelReply>((resolve) => {
        release = resolve;
      });
      const generate = vi.fn(async () => {
        entered();
        return pending;
      });
      const input = request();
      const original = sendSeoChat(actor, input, { generate });
      await active;
      try {
        expect((await sendSeoChat(actor, input, { generate })).status).toBe(
          "running",
        );
        await expect(
          sendSeoChat(actor, request("Another message"), { generate }),
        ).rejects.toMatchObject({ status: 409 });
        expect(generate).toHaveBeenCalledTimes(1);
      } finally {
        release(modelReply);
      }
      expect((await original).status).toBe("completed");
    });

    it("shares organization history and saved analytics without exposing personal connection records to inference", async () => {
      const { actor, workspace } =
        await createConversation("Private analytics");
      await recordNativeSeoMetrics(actor, {
        provider: "ga4",
        propertyId: "properties/private-owner",
        pageUrls: [pageUrl],
        channel: "all",
        from: "2026-11-01",
        to: "2026-11-02",
        timeZone: "UTC",
        observedAt: new Date().toISOString(),
        coverage: "complete",
        notes: [],
        metrics: [
          {
            key: "page_views",
            label: "Owner private page views",
            unit: "count",
            value: 321,
            points: [],
          },
        ],
      });
      await prisma.seoConnection.create({
        data: {
          workspaceId,
          userId: firstUserId,
          provider: "ga4",
          authConfigId: "connection-config-must-stay-private",
          composioAccountId: "connected-account-must-stay-private",
          entityId: "connection-entity-must-stay-private",
        },
      });
      const firstPrompt = vi.fn(async (_system: string, prompt: string) => {
        const envelope = JSON.parse(prompt);
        const evidence = JSON.parse(envelope.auditEvidence);
        expect(evidence.metrics).toMatchObject([
          { key: "page_views", value: 321 },
        ]);
        expect(prompt).not.toContain("must-stay-private");
        expect(envelope.history).toEqual([]);
        return {
          ...modelReply,
          text: JSON.stringify({
            reply: "Your private page views are 321.",
            actions: [],
          }),
        };
      });
      const own = await sendSeoChat(actor, request("My private analytics"), {
        generate: firstPrompt,
      });
      const other = { ...secondActor, owner: actor.owner };
      await sendSeoChat(other, request("My own question"), {
        generate: async (_system, prompt) => {
          const envelope = JSON.parse(prompt);
          expect(envelope.history).toMatchObject([
            { question: "My private analytics" },
          ]);
          expect(JSON.parse(envelope.auditEvidence).metrics).toMatchObject([
            { key: "page_views", value: 321 },
          ]);
          expect(prompt).not.toContain("must-stay-private");
          return modelReply;
        },
      });
      expect((await listSeoChat(actor)).turns.map((turn) => turn.id)).toContain(
        own.id,
      );
      expect(
        (await listSeoChat(other)).turns.some((turn) => turn.id === own.id),
      ).toBe(true);
      const foreign = { ...outsideActor, owner: actor.owner };
      const deniedGenerate = vi.fn(async () => modelReply);
      await expect(listSeoChat(foreign)).rejects.toMatchObject({ status: 404 });
      await expect(
        sendSeoChat(foreign, request(), { generate: deniedGenerate }),
      ).rejects.toMatchObject({ status: 404 });
      expect(deniedGenerate).not.toHaveBeenCalled();
      expect(workspace.projectId).toBeNull();
    });

    it("refuses a reply after membership is revoked during inference and retains its incurred cost", async () => {
      const { actor } = await createConversation("Revoked while generating");
      const input = request();
      try {
        await expect(
          sendSeoChat(actor, input, {
            generate: async () => {
              await prisma.member.deleteMany({
                where: { organizationId, userId: firstUserId },
              });
              return modelReply;
            },
          }),
        ).rejects.toMatchObject({ status: 404 });
        const row = await prisma.seoAuditChatTurn.findUniqueOrThrow({
          where: {
            auditId_userId_idempotencyKey: {
              auditId: actor.owner.id,
              userId: firstUserId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        expect(row).toMatchObject({
          status: "failed",
          response: null,
          costUsd: modelReply.costUsd,
        });
        await expect(listSeoChat(actor)).rejects.toMatchObject({ status: 404 });
      } finally {
        await prisma.member.upsert({
          where: {
            userId_organizationId: { userId: firstUserId, organizationId },
          },
          create: {
            userId: firstUserId,
            organizationId,
            role: "member",
            seatAssignedAt: new Date(),
          },
          update: {},
        });
      }
    });

    it("rejects an unknown model action without storing a reply, while retaining the paid inference cost", async () => {
      const { actor } = await createConversation("Invalid model output");
      const input = request();
      await expect(
        sendSeoChat(actor, input, {
          generate: async () => ({
            text: JSON.stringify({
              reply: "I can run arbitrary code",
              actions: [{ kind: "execute", command: "publish" }],
            }),
            costUsd: 0.017,
          }),
        }),
      ).rejects.toThrow();
      expect(
        await prisma.seoAuditChatTurn.findUnique({
          where: {
            auditId_userId_idempotencyKey: {
              auditId: actor.owner.id,
              userId: firstUserId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        }),
      ).toMatchObject({
        status: "failed",
        response: null,
        actions: [],
        costUsd: 0.017,
      });
    });

    it("removes paused analysis actions from new replies, completed history and replay", async () => {
      const { actor } = await createConversation("Dispatch policy");
      const previous = getEnv().SEO_ANALYSIS_DISPATCH_ENABLED;
      const previousExecutor = getEnv().SEO_ANALYSIS_EXECUTOR;
      const vendorId = randomUUID();
      const coworkerId = randomUUID();
      await prisma.vendor.create({
        data: { id: vendorId, name: "Chat check service", slug: vendorId },
      });
      await prisma.coworker.create({
        data: {
          id: coworkerId,
          name: "Chat check service",
          slug: coworkerId,
          vendorId,
          capabilities: ["tasks"],
          isWhitelisted: true,
        },
      });
      const actions = [
        { kind: "open", dialog: "analysis" },
        { kind: "open", dialog: "keyword" },
        { kind: "connect", provider: "ga4" },
      ];
      const generate = vi.fn(async () => ({
        ...modelReply,
        text: JSON.stringify({ reply: "Choose a next step", actions }),
      }));
      const input = request();
      try {
        getEnv().SEO_ANALYSIS_DISPATCH_ENABLED = true;
        getEnv().SEO_ANALYSIS_EXECUTOR = {
          coworkerId,
          workspaceId,
          ownerId: actor.userId,
          organizationId,
          canUsePaidSearchData: false,
          canSchedule: false,
        };
        expect(
          (await sendSeoChat(actor, input, { generate })).actions,
        ).toHaveLength(3);
        const trustedExecutor = getEnv().SEO_ANALYSIS_EXECUTOR;
        getEnv().SEO_ANALYSIS_EXECUTOR = undefined;
        const allowed = actions.slice(1);
        expect((await listSeoChat(actor)).turns[0].actions).toEqual(allowed);
        expect((await sendSeoChat(actor, input, { generate })).actions).toEqual(
          allowed,
        );
        expect(generate).toHaveBeenCalledTimes(1);
        getEnv().SEO_ANALYSIS_EXECUTOR = trustedExecutor;
        getEnv().SEO_ANALYSIS_DISPATCH_ENABLED = false;
        expect((await listSeoChat(actor)).turns[0].actions).toEqual(allowed);
        expect((await sendSeoChat(actor, input, { generate })).actions).toEqual(
          allowed,
        );
        expect(generate).toHaveBeenCalledTimes(1);
        expect(
          (
            await sendSeoChat(actor, request("Next steps while paused"), {
              generate,
            })
          ).actions,
        ).toEqual(allowed);
      } finally {
        getEnv().SEO_ANALYSIS_DISPATCH_ENABLED = previous;
        getEnv().SEO_ANALYSIS_EXECUTOR = previousExecutor;
        await prisma.coworker.delete({ where: { id: coworkerId } });
        await prisma.vendor.delete({ where: { id: vendorId } });
      }
    });
  },
);
