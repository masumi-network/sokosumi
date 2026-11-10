import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import prisma from "@/lib/db/prisma";
import type { NativeSeoMetrics, SeoActor } from "@/schemas/project-seo.schema";
import {
  addProjectSeoPage,
  getProjectSeoWorkspace,
  recordNativeSeoMetrics,
} from "./project-seo.service";
import { listProjectSeoStatisticsProperties } from "./project-seo-statistics.service";
import { sha256 } from "./project-seo-store";
import {
  createSeoAudit,
  getSeoAuditWorkspaceMapping,
} from "./seo-audit.service";
import { listSeoChat, sendSeoChat } from "./seo-chat.service";
import { disconnectSeoConnection } from "./seo-connection-oauth.service";
import {
  getSeoConnection,
  resolveSeoStatisticsIntegration,
} from "./seo-connections.service";

const boundary = vi.hoisted(() => ({
  deleteAccount: vi.fn(async () => undefined),
  tools: vi.fn(async () => {
    throw new Error("Unexpected provider metadata request");
  }),
  read: vi.fn(async () => {
    throw new Error("Unexpected provider data request");
  }),
}));
vi.mock("@/clients/composio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/composio.client")>()),
  getComposio: () => ({}),
  deleteProjectSocialConnectionIntent: boundary.deleteAccount,
}));
vi.mock(
  "@/services/composio-integration-tools.service",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/services/composio-integration-tools.service")
    >()),
    listIntegrationTools: boundary.tools,
    readIntegrationTool: boundary.read,
  }),
);

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const firstUserId = randomUUID(),
  secondUserId = randomUUID(),
  foreignUserId = randomUUID();
const organizationId = randomUUID(),
  workspaceId = randomUUID(),
  foreignWorkspaceId = randomUUID();
const firstMember = { userId: firstUserId, workspaceId, organizationId };
const secondMember = { userId: secondUserId, workspaceId, organizationId };
const outsider = {
  userId: foreignUserId,
  workspaceId: foreignWorkspaceId,
  organizationId: null,
};
const pageUrl = "https://example.test/shared-audit";
const modelReply = {
  text: JSON.stringify({
    reply: "Review the shared measurements.",
    actions: [],
  }),
  costUsd: 0.012,
};
const question = (text: string) => ({
  question: text,
  idempotencyKey: randomUUID(),
});

function metrics(value: number, name = "Shared page views"): NativeSeoMetrics {
  return {
    provider: "ga4",
    propertyId: "properties/123",
    pageUrls: [pageUrl],
    channel: "all",
    from: "2026-11-01",
    to: "2026-11-02",
    timeZone: "UTC",
    observedAt: new Date().toISOString(),
    coverage: "complete",
    notes: [],
    metrics: [
      { key: "page_views", label: name, unit: "count", value, points: [] },
    ],
  };
}

async function audit(name: string, projectId?: string) {
  const workspace = await createSeoAudit(firstMember, {
    name,
    firstPage: { url: pageUrl, relationship: "primary" },
    ...(projectId ? { projectId } : {}),
  });
  if (!workspace.auditId) throw new Error("Expected a native Audit");
  const actor: SeoActor = {
    ...firstMember,
    owner: { kind: "audit", id: workspace.auditId },
  };
  const other: SeoActor = { ...secondMember, owner: actor.owner };
  return { workspace, actor, other };
}

async function legacyPrivateRows(actor: SeoActor, pageIds: string[]) {
  const payload = metrics(987, "Legacy private measurement");
  const at = new Date();
  const legacyRequest = question("Legacy private question");
  // Omitted visibility exercises the additive migration's PRIVATE default.
  const observation = await prisma.projectSeoObservation.create({
    data: {
      auditId: actor.owner.id,
      ownerId: firstUserId,
      kind: "metrics",
      source: "ga4",
      sourceKey: randomUUID(),
      pageIds,
      artifactHash: sha256(JSON.stringify(payload)),
      payload,
      observedAt: at,
    },
  });
  const turn = await prisma.seoAuditChatTurn.create({
    data: {
      auditId: actor.owner.id,
      userId: firstUserId,
      idempotencyKey: legacyRequest.idempotencyKey,
      requestHash: sha256(JSON.stringify(legacyRequest)),
      question: legacyRequest.question,
      response: "Legacy private reply",
      status: "completed",
      model: "fixture-only",
      scopeSnapshot: {
        name: "All pages",
        pageIds,
        scopeId: null,
        version: 0,
        from: null,
        to: null,
      },
      leaseExpiresAt: at,
      completedAt: at,
    },
  });
  return { observation, turn };
}

describe.skipIf(!enabled)(
  "Organization Audit context with real storage and membership",
  () => {
    beforeAll(async () => {
      for (const [id, name] of [
        [firstUserId, "First shared Audit member"],
        [secondUserId, "Second shared Audit member"],
        [foreignUserId, "Foreign Audit owner"],
      ])
        await prisma.user.create({
          data: {
            id,
            name,
            email: `${id}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: "Shared Audit fixture",
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
        data: { id: foreignWorkspaceId, userId: foreignUserId },
      });
    });
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("Unexpected live network request");
        }),
      );
    });
    afterEach(() => vi.unstubAllGlobals());
    afterAll(async () => {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.workspace.deleteMany({ where: { id: foreignWorkspaceId } });
      await prisma.user.deleteMany({
        where: { id: { in: [firstUserId, secondUserId, foreignUserId] } },
      });
      await prisma.$disconnect();
    });

    it("shares new organization measurements and authored chat across current members without transferring account access", async () => {
      const { actor, other } = await audit("Shared members");
      await prisma.seoConnection.create({
        data: {
          workspaceId,
          userId: firstUserId,
          provider: "ga4",
          status: "ACTIVE",
          composioAccountId: "shared-test-owner-account",
          entityId: "shared-test-owner-entity",
          authConfigId: "private-config-must-not-enter-model",
        },
      });
      const storedMetric = await recordNativeSeoMetrics(actor, metrics(321));
      expect(storedMetric).toMatchObject({
        ownerId: firstUserId,
        visibility: "SHARED",
      });
      const first = await sendSeoChat(actor, question("Shared measurements?"), {
        generate: vi.fn(async () => modelReply),
      });
      expect(first).toMatchObject({
        author: { id: firstUserId, name: "First shared Audit member" },
      });
      expect(
        await prisma.seoAuditChatTurn.findUniqueOrThrow({
          where: { id: first.id },
        }),
      ).toMatchObject({ visibility: "SHARED" });
      const shared = await getProjectSeoWorkspace(other);
      expect(shared).toMatchObject({
        sharing: "organization",
        metrics: [expect.objectContaining({ value: 321 })],
      });
      expect(await listSeoChat(other)).toMatchObject({
        sharing: "organization",
        turns: [
          expect.objectContaining({
            id: first.id,
            author: { id: firstUserId, name: "First shared Audit member" },
          }),
        ],
      });
      const generate = vi.fn(async (_system: string, prompt: string) => {
        const envelope = JSON.parse(prompt);
        expect(envelope.history).toEqual([
          {
            question: "Shared measurements?",
            reply: "Review the shared measurements.",
          },
        ]);
        expect(JSON.parse(envelope.auditEvidence).metrics).toMatchObject([
          { key: "page_views", value: 321 },
        ]);
        expect(prompt).not.toMatch(
          /shared-test-owner-account|shared-test-owner-entity|private-config-must-not-enter-model/,
        );
        return modelReply;
      });
      const second = await sendSeoChat(other, question("What changed?"), {
        generate,
      });
      expect(second).toMatchObject({
        author: { id: secondUserId, name: "Second shared Audit member" },
      });
      expect((await listSeoChat(actor)).turns.map((turn) => turn.id)).toEqual([
        first.id,
        second.id,
      ]);
      expect(
        await resolveSeoStatisticsIntegration(firstMember, "ga4"),
      ).toMatchObject({ composioAccountId: "shared-test-owner-account" });
      expect(
        await resolveSeoStatisticsIntegration(secondMember, "ga4"),
      ).toBeNull();
      expect(await getSeoConnection(secondMember, "ga4")).toMatchObject({
        status: "not_connected",
        source: "none",
      });
      expect(
        await listProjectSeoStatisticsProperties(other, "ga4"),
      ).toMatchObject({ status: "not_connected", properties: [] });
      await disconnectSeoConnection(secondMember, "ga4");
      expect(await getSeoConnection(firstMember, "ga4")).toMatchObject({
        status: "connected",
        source: "native",
      });
      expect(boundary.deleteAccount).not.toHaveBeenCalled();
      expect(boundary.tools).not.toHaveBeenCalled();
      expect(boundary.read).not.toHaveBeenCalled();
    });

    it("excludes legacy private turns and measurements from organization context even for their original author", async () => {
      const { actor, other, workspace } = await audit("Legacy isolation");
      const legacy = await legacyPrivateRows(actor, workspace.scope.pageIds);
      expect(legacy.observation).toMatchObject({ visibility: "PRIVATE" });
      expect(legacy.turn).toMatchObject({ visibility: "PRIVATE" });
      for (const reader of [actor, other]) {
        expect((await getProjectSeoWorkspace(reader)).metrics).toEqual([]);
        expect((await listSeoChat(reader)).turns).toEqual([]);
      }
      const deniedGenerate = vi.fn(async () => modelReply);
      await expect(
        sendSeoChat(
          actor,
          {
            question: legacy.turn.question,
            idempotencyKey: legacy.turn.idempotencyKey,
          },
          { generate: deniedGenerate },
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(deniedGenerate).not.toHaveBeenCalled();
      const generated = vi.fn(async (_system: string, prompt: string) => {
        const envelope = JSON.parse(prompt);
        expect(envelope.history).toEqual([]);
        expect(JSON.parse(envelope.auditEvidence).metrics).toEqual([]);
        expect(prompt).not.toContain("Legacy private");
        return modelReply;
      });
      await sendSeoChat(actor, question("Explain only shared context"), {
        generate: generated,
      });
      expect(generated).toHaveBeenCalledTimes(1);
    });

    it("keeps personal Audit context private while returning explicit sharing metadata", async () => {
      const workspace = await createSeoAudit(outsider, {
        name: "Personal remains private",
        firstPage: { url: pageUrl, relationship: "primary" },
      });
      if (!workspace.auditId) throw new Error("Expected personal Audit");
      const actor: SeoActor = {
        ...outsider,
        owner: { kind: "audit", id: workspace.auditId },
      };
      expect(workspace).toMatchObject({ sharing: "personal" });
      expect(await recordNativeSeoMetrics(actor, metrics(12))).toMatchObject({
        visibility: "PRIVATE",
      });
      const turn = await sendSeoChat(actor, question("My personal Audit"), {
        generate: async () => modelReply,
      });
      expect(await listSeoChat(actor)).toMatchObject({
        sharing: "personal",
        turns: [expect.objectContaining({ id: turn.id })],
      });
      expect((await getProjectSeoWorkspace(actor)).metrics).toMatchObject([
        { value: 12 },
      ]);
    });

    it("rejects a foreign Workspace and a member whose access was revoked", async () => {
      const { actor, other } = await audit("Membership fences");
      const deniedGenerate = vi.fn(async () => modelReply);
      const foreign: SeoActor = { ...outsider, owner: actor.owner };
      await expect(getProjectSeoWorkspace(foreign)).rejects.toMatchObject({
        status: 404,
      });
      await expect(listSeoChat(foreign)).rejects.toMatchObject({ status: 404 });
      await expect(
        sendSeoChat(foreign, question("Foreign read"), {
          generate: deniedGenerate,
        }),
      ).rejects.toMatchObject({ status: 404 });
      await prisma.member.deleteMany({
        where: { organizationId, userId: secondUserId },
      });
      try {
        await expect(getProjectSeoWorkspace(other)).rejects.toMatchObject({
          status: 404,
        });
        await expect(listSeoChat(other)).rejects.toMatchObject({ status: 404 });
        await expect(
          sendSeoChat(other, question("Revoked read"), {
            generate: deniedGenerate,
          }),
        ).rejects.toMatchObject({ status: 404 });
        expect(deniedGenerate).not.toHaveBeenCalled();
      } finally {
        await prisma.member.create({
          data: {
            organizationId,
            userId: secondUserId,
            role: "member",
            seatAssignedAt: new Date(),
          },
        });
      }
    });

    it("maps an Audit to its workspace only for a reader who can open it after a switch", async () => {
      const { actor } = await audit("Workspace mapping");
      const id = actor.owner.id;
      const mapping = { workspaceId, organizationId };
      await expect(
        getSeoAuditWorkspaceMapping(firstUserId, id),
      ).resolves.toMatchObject(mapping);
      await expect(
        getSeoAuditWorkspaceMapping(secondUserId, id),
      ).resolves.toMatchObject(mapping);
      // A stranger gets the answer of an id that does not exist.
      const missing = await getSeoAuditWorkspaceMapping(
        foreignUserId,
        randomUUID(),
      ).catch((error: unknown) => error);
      const foreign = await getSeoAuditWorkspaceMapping(
        foreignUserId,
        id,
      ).catch((error: unknown) => error);
      expect(missing).toMatchObject({ status: 404 });
      expect(foreign).toMatchObject({
        status: 404,
        message: (missing as Error).message,
      });
      // On a plan with seats, a member without one cannot open the Audit
      // after a switch.
      const contract = await prisma.enterpriseContract.create({
        data: {
          organizationId,
          status: "active",
          activatedAt: new Date(),
          periodCount: 1,
          seats: 2,
          centsPerMonth: 0n,
        },
      });
      await prisma.member.updateMany({
        where: { organizationId, userId: secondUserId },
        data: { seatAssignedAt: null },
      });
      try {
        // The seated member still gets the mapping on that plan.
        await expect(
          getSeoAuditWorkspaceMapping(firstUserId, id),
        ).resolves.toMatchObject(mapping);
        await expect(
          getSeoAuditWorkspaceMapping(secondUserId, id),
        ).rejects.toMatchObject({ status: 404 });
        await prisma.member.deleteMany({
          where: { organizationId, userId: secondUserId },
        });
        await expect(
          getSeoAuditWorkspaceMapping(secondUserId, id),
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        await prisma.enterpriseContract.delete({ where: { id: contract.id } });
        await prisma.member.deleteMany({
          where: { organizationId, userId: secondUserId },
        });
        await prisma.member.create({
          data: {
            organizationId,
            userId: secondUserId,
            role: "member",
            seatAssignedAt: new Date(),
          },
        });
      }
    });

    it("refuses to publish an organization reply when membership changes during model generation", async () => {
      const { actor, other } = await audit("Revoked during reply");
      const input = question("Member before the reply");
      let release!: (value: typeof modelReply) => void;
      let entered!: () => void;
      let memberRemoved = false;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const reply = new Promise<typeof modelReply>((resolve) => {
        release = resolve;
      });
      const active = sendSeoChat(actor, input, {
        generate: async () => {
          entered();
          return reply;
        },
      });
      await started;
      try {
        const concurrentGenerate = vi.fn(async () => modelReply);
        await expect(
          sendSeoChat(
            other,
            question("Another member while the shared reply runs"),
            { generate: concurrentGenerate },
          ),
        ).rejects.toMatchObject({ status: 409 });
        expect(concurrentGenerate).not.toHaveBeenCalled();
        await prisma.member.deleteMany({
          where: { organizationId, userId: firstUserId },
        });
        memberRemoved = true;
        release(modelReply);
        await expect(active).rejects.toMatchObject({ status: 404 });
        expect(
          await prisma.seoAuditChatTurn.findUniqueOrThrow({
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
          costUsd: modelReply.costUsd,
        });
      } finally {
        release(modelReply);
        await active.catch(() => undefined);
        if (memberRemoved)
          await prisma.member.create({
            data: {
              organizationId,
              userId: firstUserId,
              role: "member",
              seatAssignedAt: new Date(),
            },
          });
      }
    });

    it("requires the linked Project to stay in the Audit Workspace", async () => {
      const foreignProject = await prisma.project.create({
        data: { workspaceId: foreignWorkspaceId, name: "Foreign Project" },
      });
      await expect(
        audit("Foreign link", foreignProject.id),
      ).rejects.toMatchObject({ status: 404 });
      const project = await prisma.project.create({
        data: { workspaceId, name: "Linked Project" },
      });
      const { actor } = await audit("Project moved later", project.id);
      await prisma.project.update({
        where: { id: project.id },
        data: { workspaceId: foreignWorkspaceId },
      });
      try {
        await expect(getProjectSeoWorkspace(actor)).rejects.toMatchObject({
          status: 404,
        });
        await expect(listSeoChat(actor)).rejects.toMatchObject({ status: 404 });
      } finally {
        await prisma.project.update({
          where: { id: project.id },
          data: { workspaceId },
        });
      }
    });

    it("blocks linked Project writes after closure and does not start a model call", async () => {
      const project = await prisma.project.create({
        data: { workspaceId, name: "Closing Project" },
      });
      const { actor } = await audit("Read-only linked Audit", project.id);
      await prisma.project.update({
        where: { id: project.id },
        data: { closingAt: new Date() },
      });
      const generate = vi.fn(async () => modelReply);
      expect(
        (await getProjectSeoWorkspace(actor)).availableActions.canEdit,
      ).toBe(false);
      await expect(
        addProjectSeoPage(actor, {
          url: "https://example.test/closed",
          relationship: "related",
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        recordNativeSeoMetrics(actor, metrics(42)),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        sendSeoChat(actor, question("Cannot write closed context"), {
          generate,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(generate).not.toHaveBeenCalled();
    });

    it("rechecks linked Project closure after a deferred model reply and records the incurred cost without publishing it", async () => {
      const project = await prisma.project.create({
        data: { workspaceId, name: "Project closes during reply" },
      });
      const { actor } = await audit("Closure race", project.id);
      let release!: (value: typeof modelReply) => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const reply = new Promise<typeof modelReply>((resolve) => {
        release = resolve;
      });
      const input = question("Explain before closing");
      const active = sendSeoChat(actor, input, {
        generate: async () => {
          entered();
          return reply;
        },
      });
      await started;
      try {
        await prisma.project.update({
          where: { id: project.id },
          data: { closingAt: new Date() },
        });
      } finally {
        release(modelReply);
      }
      await expect(active).rejects.toMatchObject({ status: 409 });
      expect(
        await prisma.seoAuditChatTurn.findUniqueOrThrow({
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
        costUsd: modelReply.costUsd,
      });
    });
  },
);
