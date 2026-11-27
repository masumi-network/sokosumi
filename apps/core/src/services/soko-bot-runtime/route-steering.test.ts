import {
  getSokoBotVersion,
  SOKO_BOT_CAPABILITIES,
  type SokoBotVersion,
} from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRESET_VERSION } from "@/lib/soko-bot/classifier";

const {
  authorizeMock,
  snapshotFindFirstMock,
  turnFindUniqueMock,
  mcpFindManyMock,
  resolveVersionMock,
  loadPersonaMock,
  appendedEvents,
} = vi.hoisted(() => ({
  authorizeMock: vi.fn(),
  snapshotFindFirstMock: vi.fn(),
  turnFindUniqueMock: vi.fn(),
  mcpFindManyMock: vi.fn(),
  resolveVersionMock: vi.fn(),
  loadPersonaMock: vi.fn(),
  appendedEvents: [] as Array<{ type: string; data: Record<string, unknown> }>,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotContextSnapshot: { findFirst: snapshotFindFirstMock },
    sokoBotTurn: { findUnique: turnFindUniqueMock },
    sokoBotMcpServer: { findMany: mcpFindManyMock },
    $transaction: async (
      fn: (tx: {
        $executeRaw: () => Promise<number>;
        sokoBotRuntimeEvent: {
          findFirst: () => Promise<null>;
          create: (args: {
            data: { type: string; data: Record<string, unknown> };
          }) => Promise<void>;
        };
      }) => Promise<unknown>,
    ) =>
      fn({
        $executeRaw: async () => 0,
        sokoBotRuntimeEvent: {
          findFirst: async () => null,
          create: async ({ data }) => {
            appendedEvents.push({ type: data.type, data: data.data });
          },
        },
      }),
  },
}));

vi.mock("@/lib/db/database-now", () => ({
  databaseNow: async () => new Date("2026-11-27T06:00:00Z"),
}));

vi.mock("@/helpers/soko-bot-owner", () => ({
  loadSokoBotPersona: (...args: unknown[]) => loadPersonaMock(...args),
}));

vi.mock("@/services/soko-bot-version.service", () => ({
  resolveSokoBotVersion: (...args: unknown[]) => resolveVersionMock(...args),
  resolveRunnableSokoBotVersion: (...args: unknown[]) =>
    resolveVersionMock(...args),
}));

vi.mock("@/services/cmo-cuso.service", () => ({
  ONBOARDING_TURN_PREFIX: "cmo:onboarding:",
}));

vi.mock("@/services/cmo-hiring.service", () => ({
  cmoTurnParts: async () => [],
}));

vi.mock("@/lib/soko-bot/request-chain", () => ({
  readRequestPlan: async () => null,
  resolveRequestId: async () => "req-1",
  planRecital: () => "",
  withChainPlan: async (_turnId: string, text: string) => text,
}));

const contextMod = await import("./context");

vi.mock("@/services/soko-bot-runtime.service", () => {
  class MockSokoBotRuntimeService {
    authorize(input: Parameters<typeof authorizeMock>[0]) {
      return authorizeMock(input);
    }
    getContext(
      input: Parameters<typeof contextMod.getContext>[1],
      options?: Parameters<typeof contextMod.getContext>[2],
    ) {
      return contextMod.getContext(
        { authorize: authorizeMock } as never,
        input,
        options,
      );
    }
  }
  return {
    SokoBotRuntimeAuthorizationError: class extends Error {},
    SokoBotRuntimeValidationError: class extends Error {},
    SokoBotRuntimeService: MockSokoBotRuntimeService,
    sokoBotRuntimeService: new MockSokoBotRuntimeService(),
  };
});

const { prepareTurn } = await import("@/lib/soko-bot/turn-loop");
const { dispatchOtherTools } = await import("./dispatch-other");

function makeSnapshot(askedByKind: "OWNER" | "TEAMMATE" = "OWNER") {
  return {
    packet: {
      schemaVersion: 1,
      trigger: {
        source: "CHAT",
        route: "CLARIFY",
        confidence: 0.42,
        unsureRoute: "MANAGE_WORK",
        requestedOutcome: "Rename the draft and update its date",
        hints: ["The message likely points back at earlier messages."],
        askedBy: {
          kind: askedByKind,
          name: askedByKind === "OWNER" ? "Ana" : "Marco",
          trust: "untrusted-data",
        },
      },
      workspace: {},
      recentTurns: [],
    },
    hash: "snap-hash",
    schemaVersion: 1,
    generatedAt: new Date("2026-11-27T06:00:00Z"),
  };
}

function makeAuthorized(overrides: {
  versionId: string;
  askedByKind?: "OWNER" | "TEAMMATE" | "ASSISTANT";
  source?: string;
  chainDepth?: number;
  parentTurnId?: string | null;
  meetingPrep?: boolean;
}) {
  return {
    turn: {
      id: "turn-1",
      sokoBotId: "bot-1",
      actingUserId: "user-1",
      requestedByUserId: "user-1",
      workspaceId: "ws-1",
      eveSessionId: "sess-1",
      versionId: overrides.versionId,
      source: overrides.source ?? "CHAT",
      chainDepth: overrides.chainDepth ?? 0,
      parentTurnId: overrides.parentTurnId ?? null,
    },
    grant: {
      contextSnapshotId: "snap-1",
      capabilities: [...SOKO_BOT_CAPABILITIES],
    },
    askedByKind: overrides.askedByKind ?? "OWNER",
    meetingPrep: overrides.meetingPrep ?? false,
  };
}

function makeSteeredSokoBotVersion(): SokoBotVersion {
  const base = getSokoBotVersion("v37");
  return {
    ...base,
    id: "v-e1-test",
    skillsOnDemand: true,
    planLoop: true,
    routeSteering: true,
  };
}

function makeControlLoopOnlyVersion(): SokoBotVersion {
  const base = getSokoBotVersion("v37");
  return {
    ...base,
    id: "v-loop-only-test",
    skillsOnDemand: true,
    planLoop: true,
  };
}

function makeSteeredCmoVersion(): SokoBotVersion {
  const base = getSokoBotVersion("cmo-v24");
  return {
    ...base,
    id: "cmo-e1-test",
    planLoop: true,
    routeSteering: true,
  };
}

describe("E1 routeSteering across opening prompts, refresh_context, runtimes, and authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appendedEvents.length = 0;
    mcpFindManyMock.mockResolvedValue([]);
    loadPersonaMock.mockResolvedValue({ name: "Nova", shared: false });
  });

  it("hides route in both in-process and sandbox opening prompts and in refresh_context while keeping skill preloading and DB snapshot diagnostics", async () => {
    const version = makeSteeredSokoBotVersion();
    const snapshot = makeSnapshot("OWNER");
    const authorized = makeAuthorized({ versionId: version.id });

    authorizeMock.mockResolvedValue(authorized);
    resolveVersionMock.mockResolvedValue(version);
    snapshotFindFirstMock.mockResolvedValue(snapshot);
    turnFindUniqueMock.mockResolvedValue({
      clientTurnId: null,
      source: "CHAT",
      route: "CLARIFY",
      parentTurnId: null,
      chainDepth: 0,
      classifierVersion: "soko-bot-classifier-jev-seo-v3",
      classification: {
        rawRoute: "MANAGE_WORK",
        rawConfidence: 0.52,
        workConfidence: 0.68,
        abstained: true,
      },
    });

    // Test BOTH runtimes: in-process (sandbox: false, web: true) and sandbox (sandbox: true).
    for (const runtimeOptions of [
      { sandbox: false, web: true },
      { sandbox: true },
    ]) {
      appendedEvents.length = 0;
      const prepared = await prepareTurn("sess-1", "turn-1", runtimeOptions);

      expect(prepared.system).toContain("# Act or ask");
      expect(prepared.system).not.toContain("# Routes");
      expect(prepared.system).not.toContain("no work tools are present");
      expect(prepared.preamble).not.toContain('"route"');
      expect(prepared.preamble).not.toContain('"confidence"');
      expect(prepared.preamble).not.toContain('"unsureRoute"');
      expect(prepared.preamble).toContain('"askedBy":{"kind":"OWNER"');
      // Work skills still preload from workConfidence / rawRoute despite CLARIFY fallback.
      expect(prepared.preamble).toContain("# Skills for this turn");
      expect(appendedEvents).toContainEqual(
        expect.objectContaining({
          type: "skills.preloaded",
          data: expect.objectContaining({
            occasions: ["MANAGE_WORK"],
            preloaded: expect.arrayContaining(["taskboard"]),
          }),
        }),
      );
    }

    // refresh_context returns the same model-visible projection (no trigger.route and no version.skillOccasions).
    const runtimeOps = {
      authorize: authorizeMock,
      getContext: (input: Parameters<typeof contextMod.getContext>[1]) =>
        contextMod.getContext({ authorize: authorizeMock } as never, input),
    };
    const refreshed = (await dispatchOtherTools(
      runtimeOps as never,
      {
        sessionId: "sess-1",
        turnId: "turn-1",
        toolCallId: "tc-1",
        capability: "refresh_context",
        input: {},
      },
      authorized as never,
    )) as {
      packet: { trigger: Record<string, unknown> };
      version: Record<string, unknown>;
    };

    expect(refreshed.packet.trigger).not.toHaveProperty("route");
    expect(refreshed.packet.trigger).not.toHaveProperty("confidence");
    expect(refreshed.packet.trigger).not.toHaveProperty("unsureRoute");
    expect(refreshed.version).not.toHaveProperty("skillOccasions");
    expect(refreshed.version.preloadedSkills).toContain("taskboard");

    // Persisted snapshot object stays full and unmutated for diagnostics.
    expect(snapshot.packet.trigger.route).toBe("CLARIFY");
    expect(snapshot.packet.trigger.confidence).toBe(0.42);
    expect(snapshot.packet.trigger.unsureRoute).toBe("MANAGE_WORK");
  });

  it("preserves original route, scope, and skillOccasions on autonomous, background, and preset turns", async () => {
    const version = makeSteeredSokoBotVersion();
    resolveVersionMock.mockResolvedValue(version);

    for (const scenario of [
      {
        label: "scheduled turn",
        source: "SCHEDULE",
        parentTurnId: null,
        classifierVersion: "soko-bot-classifier-jev-seo-v3",
        askedByKind: "OWNER" as const,
      },
      {
        label: "background child turn",
        source: "CHAT",
        parentTurnId: "turn-parent",
        classifierVersion: "soko-bot-classifier-jev-seo-v3",
        askedByKind: "OWNER" as const,
      },
      {
        label: "preset turn",
        source: "CHAT",
        parentTurnId: null,
        classifierVersion: PRESET_VERSION,
        askedByKind: "OWNER" as const,
      },
    ]) {
      const snapshot = makeSnapshot("OWNER");
      snapshot.packet.trigger.source = scenario.source;
      const authorized = makeAuthorized({
        versionId: version.id,
        source: scenario.source,
        parentTurnId: scenario.parentTurnId,
        askedByKind: scenario.askedByKind,
      });
      authorizeMock.mockResolvedValue(authorized);
      snapshotFindFirstMock.mockResolvedValue(snapshot);
      turnFindUniqueMock.mockResolvedValue({
        clientTurnId: null,
        source: scenario.source,
        route: "CLARIFY",
        parentTurnId: scenario.parentTurnId,
        chainDepth: 0,
        classifierVersion: scenario.classifierVersion,
        classification: null,
      });

      const prepared = await prepareTurn("sess-1", "turn-1", { sandbox: true });
      expect(prepared.preamble, scenario.label).toContain('"route":"CLARIFY"');

      const refreshed = (await contextMod.getContext(
        { authorize: authorizeMock } as never,
        { sessionId: "sess-1", turnId: "turn-1" },
      )) as {
        packet: { trigger: Record<string, unknown> };
        version: Record<string, unknown>;
      };
      expect(refreshed.packet.trigger.route, scenario.label).toBe("CLARIFY");
      expect(refreshed.version.skillOccasions, scenario.label).toContain(
        "CLARIFY",
      );
    }
  });

  it("keeps speaker authority separate from foreground route steering on shared Cuso (TEAMMATE) and personal-bot teammate turns", async () => {
    const cmoVersion = makeSteeredCmoVersion();
    const snapshot = makeSnapshot("TEAMMATE");
    const authorized = makeAuthorized({
      versionId: cmoVersion.id,
      askedByKind: "TEAMMATE",
    });

    authorizeMock.mockResolvedValue(authorized);
    resolveVersionMock.mockResolvedValue(cmoVersion);
    loadPersonaMock.mockResolvedValue({ name: "Cuso", shared: true });
    snapshotFindFirstMock.mockResolvedValue(snapshot);
    turnFindUniqueMock.mockResolvedValue({
      clientTurnId: null,
      source: "CHAT",
      route: "CLARIFY",
      parentTurnId: null,
      chainDepth: 0,
      classifierVersion: "soko-bot-classifier-jev-seo-v3",
      classification: { rawRoute: "MANAGE_WORK", workConfidence: 0.7 },
    });

    const prepared = await prepareTurn("sess-1", "turn-1", { sandbox: true });
    // Route is hidden for the typed chat turn, while askedBy stays TEAMMATE (no owner escalation).
    expect(prepared.preamble).not.toContain('"route"');
    expect(prepared.preamble).toContain('"askedBy":{"kind":"TEAMMATE"');
    expect(prepared.system).toContain(
      "Authority follows the speaker and grant",
    );
    expect(prepared.system).toContain(
      "pending or draft state until authorized",
    );
  });

  it("leaves loop-only control versions without routeSteering completely unchanged", async () => {
    const control = makeControlLoopOnlyVersion();
    const snapshot = makeSnapshot("OWNER");
    const authorized = makeAuthorized({ versionId: control.id });

    authorizeMock.mockResolvedValue(authorized);
    resolveVersionMock.mockResolvedValue(control);
    snapshotFindFirstMock.mockResolvedValue(snapshot);
    turnFindUniqueMock.mockResolvedValue({
      clientTurnId: null,
      source: "CHAT",
      route: "CLARIFY",
      parentTurnId: null,
      chainDepth: 0,
      classifierVersion: "soko-bot-classifier-jev-seo-v3",
      classification: { rawRoute: "MANAGE_WORK", workConfidence: 0.4 },
    });

    const prepared = await prepareTurn("sess-1", "turn-1", {
      sandbox: false,
      web: true,
    });
    expect(prepared.system).toContain("# Routes");
    expect(prepared.system).not.toContain("# Act or ask");
    expect(prepared.preamble).toContain('"route":"CLARIFY"');
    expect(prepared.preamble).toContain('"confidence":0.42');

    const refreshed = (await contextMod.getContext(
      { authorize: authorizeMock } as never,
      { sessionId: "sess-1", turnId: "turn-1" },
    )) as {
      packet: { trigger: Record<string, unknown> };
      version: Record<string, unknown>;
    };
    expect(refreshed.packet.trigger.route).toBe("CLARIFY");
    expect(refreshed.version.skillOccasions).toEqual(["CLARIFY"]);
  });
});
