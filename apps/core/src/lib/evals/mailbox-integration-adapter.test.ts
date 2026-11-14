import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  evalResult: { findUnique: vi.fn() },
  evalLane: { findUnique: vi.fn() },
  sokoBot: { findFirst: vi.fn() },
  workspace: { findFirst: vi.fn() },
  organization: { findFirst: vi.fn() },
  sokoBotTurn: { findFirst: vi.fn() },
  sokoBotIntegration: { findMany: vi.fn(), update: vi.fn() },
}));
const external = vi.hoisted(() => ({ getComposio: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("@/clients/composio.client", () => ({
  getComposio: external.getComposio,
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({ NETWORK: "Preprod", COMPOSIO_API_KEY: "fixture-test" }),
}));

import { withEvaluationActor } from "@/lib/soko-bot/evaluation-dispatch";
import {
  executeIntegrationTool,
  listIntegrationTools,
  readIntegrationTool,
  runIntegrationTool,
} from "@/services/composio-integration-tools.service";
import { listSokoBotIntegrationsForBot } from "@/services/soko-bot-integration-list.service";
import {
  activeIntegrationsForBot,
  fetchCalendarEvents,
  fetchInboxMessage,
  fetchInboxMessages,
  resolveProvider,
  searchSokoBotIntegrationCatalog,
} from "@/services/soko-bot-integrations.service";
import type { MailboxFixtureBinding } from "./mailbox-binding";

function fixture(repeat: 1 | 2): MailboxFixtureBinding {
  const resultId = randomUUID();
  return {
    version: 1,
    resultId,
    runId: randomUUID(),
    caseId: "inbox-summary",
    repeat,
    referenceTime: new Date().toISOString(),
    userId: randomUUID(),
    organizationId: randomUUID(),
    workspaceId: randomUUID(),
    sokoBotId: randomUUID(),
    clientTurnId: `lab:eval:${resultId}`,
    source: "CHAT",
  };
}

function actor(binding: MailboxFixtureBinding) {
  return {
    userId: binding.userId,
    sokoBotId: binding.sokoBotId,
    clientTurnId: binding.clientTurnId,
    source: binding.source,
  };
}

describe("persisted actor-scoped mailbox integration adapters", () => {
  let bindings: MailboxFixtureBinding[];
  let resultStatus: "RUNNING" | "COMPLETED";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubGlobal("fetch", external.fetch);
    bindings = [fixture(1), fixture(2)];
    resultStatus = "RUNNING";
    db.evalResult.findUnique.mockImplementation(async ({ where }) => {
      const binding = bindings.find((entry) => entry.resultId === where.id);
      return binding
        ? {
            id: binding.resultId,
            runId: binding.runId,
            caseId: binding.caseId,
            repeat: binding.repeat,
            suite: "soko-bot",
            status: resultStatus,
            state: { mailboxFixture: binding },
            turnId: `turn-${binding.resultId}`,
            run: { status: "RUNNING", environment: "preview" },
          }
        : null;
    });
    db.evalLane.findUnique.mockImplementation(async ({ where }) => {
      const binding = bindings.find((entry) => entry.repeat === where.lane);
      return binding
        ? {
            lane: binding.repeat,
            userId: binding.userId,
            organizationId: binding.organizationId,
            workspaceId: binding.workspaceId,
            sokoBotId: binding.sokoBotId,
          }
        : null;
    });
    db.sokoBot.findFirst.mockImplementation(async ({ where }) =>
      bindings.some(
        (entry) =>
          entry.sokoBotId === where.id &&
          entry.userId === where.userId &&
          entry.workspaceId === where.workspaceId,
      )
        ? { id: where.id }
        : null,
    );
    db.workspace.findFirst.mockImplementation(async ({ where }) =>
      bindings.some(
        (entry) =>
          entry.workspaceId === where.id &&
          entry.organizationId === where.organizationId,
      )
        ? { id: where.id }
        : null,
    );
    db.organization.findFirst.mockImplementation(async ({ where }) =>
      bindings.some(
        (entry) =>
          entry.organizationId === where.id &&
          where.slug === `sokosumi-evals-${entry.repeat}`,
      )
        ? { id: where.id }
        : null,
    );
    db.sokoBotTurn.findFirst.mockImplementation(async ({ where }) => {
      const binding = bindings.find(
        (entry) =>
          entry.sokoBotId === where.sokoBotId &&
          entry.clientTurnId === where.clientTurnId,
      );
      return binding
        ? {
            id: `turn-${binding.resultId}`,
            workspaceId: binding.workspaceId,
            requestedByUserId: binding.userId,
            source: binding.source,
            status: "RUNNING",
          }
        : null;
    });
    db.sokoBotIntegration.findMany.mockResolvedValue([]);
    external.getComposio.mockReturnValue({});
    external.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ successful: true, data: { liveBoundary: true } }),
        { status: 200 },
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps two interleaved actor lanes separate through real provider normalizers", async () => {
    const outputs = await Promise.all(
      bindings.map((binding) =>
        withEvaluationActor(actor(binding), async () => {
          const [mailbox] = await activeIntegrationsForBot(
            binding.sokoBotId,
            "email",
          );
          expect(mailbox?.composioAccountId).toBe(
            `eval-mailbox:${binding.resultId}:${binding.sokoBotId}:gmail`,
          );
          await Promise.resolve();
          const messages = await fetchInboxMessages(mailbox!, { limit: 10 });
          expect(messages.length).toBeGreaterThan(0);
          const detail = await fetchInboxMessage(mailbox!, messages[0]!.id);
          expect(detail.id).toBe(messages[0]!.id);
          expect(detail.body).not.toBe("");
          const views = await listSokoBotIntegrationsForBot(binding.sokoBotId);
          expect(
            views.integrations.map((entry) => [entry.provider, entry.status]),
          ).toEqual([
            ["gmail", "ACTIVE"],
            ["googlecalendar", "ACTIVE"],
          ]);
          return messages.map((entry) => entry.id);
        }),
      ),
    );
    expect(outputs[0]).not.toEqual(outputs[1]);
    expect(db.sokoBotIntegration.findMany).not.toHaveBeenCalled();
    expect(external.getComposio).not.toHaveBeenCalled();
    expect(external.fetch).not.toHaveBeenCalled();
  });

  it("filters virtual account kinds and catalog without touching live discovery", async () => {
    const binding = bindings[0]!;
    binding.caseId = "calendar-prep";
    await withEvaluationActor(actor(binding), async () => {
      expect(
        await activeIntegrationsForBot(binding.sokoBotId, "generic"),
      ).toEqual([]);
      expect(
        await activeIntegrationsForBot(binding.sokoBotId, "email", "outlook"),
      ).toEqual([]);
      const catalog = await searchSokoBotIntegrationCatalog("calendar", 1);
      expect(catalog.map((entry) => entry.provider)).toEqual([
        "googlecalendar",
      ]);
      const [calendar] = await activeIntegrationsForBot(
        binding.sokoBotId,
        "calendar",
      );
      const from = new Date(binding.referenceTime);
      const to = new Date(from.getTime() + 3 * 24 * 60 * 60 * 1_000);
      const events = await fetchCalendarEvents(calendar!, {
        from,
        to,
        limit: 10,
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toMatchObject({
        provider: "googlecalendar",
        title: expect.any(String),
        organizer: expect.any(String),
      });
    });
    expect(db.sokoBotIntegration.update).not.toHaveBeenCalled();
    expect(external.getComposio).not.toHaveBeenCalled();
    expect(external.fetch).not.toHaveBeenCalled();
  });

  it.each([
    "GMAIL_SEND_DRAFT",
    "GMAIL_CREATE_EMAIL_DRAFT",
    "GMAIL_BATCH_MODIFY_MESSAGES",
    "GMAIL_GET_ATTACHMENT",
    "GMAIL_UNKNOWN_READ",
  ])("refuses %s before every provider or recording boundary", async (slug) => {
    const binding = bindings[0]!;
    await withEvaluationActor(actor(binding), async () => {
      const [mailbox] = await activeIntegrationsForBot(
        binding.sokoBotId,
        "email",
      );
      await expect(executeIntegrationTool(mailbox!, slug, {})).rejects.toThrow(
        "not allowed",
      );
    });
    expect(external.getComposio).not.toHaveBeenCalled();
    expect(external.fetch).not.toHaveBeenCalled();
  });

  it("rejects generic discovery, reads, writes and foreign real accounts inside a fixture actor", async () => {
    const binding = bindings[0]!;
    const real = {
      provider: resolveProvider("googlecalendar"),
      composioAccountId: "real-account",
      sokoBotId: binding.sokoBotId,
    };
    await withEvaluationActor(actor(binding), async () => {
      await expect(listIntegrationTools(real, { limit: 5 })).rejects.toThrow(
        "not allowed",
      );
      await expect(
        readIntegrationTool(real, "GOOGLECALENDAR_EVENTS_LIST", {}),
      ).rejects.toThrow("not allowed");
      await expect(
        runIntegrationTool(real, "GOOGLECALENDAR_CREATE_EVENT", {}),
      ).rejects.toThrow("not allowed");
      await expect(
        executeIntegrationTool(real, "GOOGLECALENDAR_EVENTS_LIST", {}),
      ).rejects.toThrow("not allowed");
    });
    expect(external.getComposio).not.toHaveBeenCalled();
    expect(external.fetch).not.toHaveBeenCalled();
  });

  it("rejects cross-lane references and synthetic accounts after actor context is lost", async () => {
    const first = bindings[0]!;
    const second = bindings[1]!;
    const [reference] = await withEvaluationActor(actor(first), () =>
      activeIntegrationsForBot(first.sokoBotId, "email"),
    );
    await withEvaluationActor(actor(second), async () => {
      await expect(
        executeIntegrationTool(reference!, "GMAIL_FETCH_EMAILS", {}),
      ).rejects.toThrow("not allowed");
      await expect(
        activeIntegrationsForBot(first.sokoBotId, "email"),
      ).rejects.toThrow("actor denied");
    });
    await expect(
      executeIntegrationTool(reference!, "GMAIL_FETCH_EMAILS", {}),
    ).rejects.toThrow("not allowed");
    await expect(
      listIntegrationTools(reference!, { limit: 5 }),
    ).rejects.toThrow("not allowed");
    expect(external.getComposio).not.toHaveBeenCalled();
    expect(external.fetch).not.toHaveBeenCalled();
  });

  it("revalidates terminal result state before another fixture read", async () => {
    const binding = bindings[0]!;
    await withEvaluationActor(actor(binding), async () => {
      const [mailbox] = await activeIntegrationsForBot(
        binding.sokoBotId,
        "email",
      );
      resultStatus = "COMPLETED";
      await expect(
        executeIntegrationTool(mailbox!, "GMAIL_FETCH_EMAILS", {}),
      ).rejects.toThrow("unavailable");
    });
    expect(external.getComposio).not.toHaveBeenCalled();
    expect(external.fetch).not.toHaveBeenCalled();
  });

  it.each(["id", "account", "bot", "entity", "provider"])(
    "rejects a changed fixture reference %s before provider execution",
    async (field) => {
      const binding = bindings[0]!;
      await withEvaluationActor(actor(binding), async () => {
        const [mailbox] = await activeIntegrationsForBot(
          binding.sokoBotId,
          "email",
        );
        expect(mailbox).toBeDefined();
        const changed = {
          ...mailbox!,
          ...(field === "id" ? { id: "different-integration" } : {}),
          ...(field === "account"
            ? { composioAccountId: "different-account" }
            : {}),
          ...(field === "bot" ? { sokoBotId: bindings[1]!.sokoBotId } : {}),
          ...(field === "entity"
            ? { entityId: "real-execution-identity" }
            : {}),
          ...(field === "provider"
            ? { provider: resolveProvider("googlecalendar") }
            : {}),
        };
        await expect(
          executeIntegrationTool(changed, "GMAIL_FETCH_EMAILS", {}),
        ).rejects.toThrow("not allowed");
      });
      expect(external.getComposio).not.toHaveBeenCalled();
      expect(external.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "leaves normal execution and cron discovery unchanged (ordinary actor: %s)",
    async (ordinaryActor) => {
      const binding = bindings[0]!;
      expect(
        await activeIntegrationsForBot(binding.sokoBotId, "email"),
      ).toEqual([]);
      expect(db.sokoBotIntegration.findMany).toHaveBeenCalledOnce();
      const run = () =>
        executeIntegrationTool(
          {
            provider: resolveProvider("gmail"),
            composioAccountId: "real-account",
            sokoBotId: "normal-bot",
          },
          "GMAIL_FETCH_EMAILS",
          { max_results: 1 },
        );
      const result = await (ordinaryActor
        ? withEvaluationActor(
            {
              userId: "ordinary-user",
              sokoBotId: "normal-bot",
              clientTurnId: "ordinary-request",
              source: "CHAT",
            },
            run,
          )
        : run());
      expect(result).toEqual({ liveBoundary: true });
      expect(external.fetch).toHaveBeenCalledOnce();
      expect(db.evalResult.findUnique).not.toHaveBeenCalled();
    },
  );
});
