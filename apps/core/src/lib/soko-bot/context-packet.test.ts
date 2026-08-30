import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  agentCountMock,
  agentFindManyMock,
  billingMock,
  coworkerCountMock,
  coworkerFindManyMock,
  creditCostFindManyMock,
  jobCountMock,
  jobFindManyMock,
  memoryFindFirstMock,
  pendingDecisionCountMock,
  pendingDecisionFindManyMock,
  projectCountMock,
  projectFindManyMock,
  recentTurnCountMock,
  recentTurnFindManyMock,
  taskCountMock,
  taskFindManyMock,
  transactionMock,
  userFindUniqueOrThrowMock,
  userFindUniqueMock,
  workspaceFindFirstMock,
} = vi.hoisted(() => ({
  agentCountMock: vi.fn(),
  agentFindManyMock: vi.fn(),
  billingMock: vi.fn(),
  coworkerCountMock: vi.fn(),
  coworkerFindManyMock: vi.fn(),
  creditCostFindManyMock: vi.fn(),
  jobCountMock: vi.fn(),
  jobFindManyMock: vi.fn(),
  memoryFindFirstMock: vi.fn(),
  pendingDecisionCountMock: vi.fn(),
  pendingDecisionFindManyMock: vi.fn(),
  projectCountMock: vi.fn(),
  projectFindManyMock: vi.fn(),
  recentTurnCountMock: vi.fn(),
  recentTurnFindManyMock: vi.fn(),
  taskCountMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  transactionMock: vi.fn(),
  userFindUniqueOrThrowMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  workspaceFindFirstMock: vi.fn(),
}));

vi.mock("@/helpers/subscription", () => ({
  buildCreditsPayload: billingMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    agent: { count: agentCountMock, findMany: agentFindManyMock },
    coworker: { count: coworkerCountMock, findMany: coworkerFindManyMock },
    creditCost: { findMany: creditCostFindManyMock },
    job: { count: jobCountMock, findMany: jobFindManyMock },
    project: { count: projectCountMock, findMany: projectFindManyMock },
    sokoBotTurn: {
      count: recentTurnCountMock,
      findMany: recentTurnFindManyMock,
    },
    sokoBotMemoryRevision: { findFirst: memoryFindFirstMock },
    sokoBotPendingDecision: {
      count: pendingDecisionCountMock,
      findMany: pendingDecisionFindManyMock,
    },
    task: { count: taskCountMock, findMany: taskFindManyMock },
    user: {
      findUniqueOrThrow: userFindUniqueOrThrowMock,
      findUnique: userFindUniqueMock,
    },
    workspace: { findFirst: workspaceFindFirstMock },
  },
}));

import {
  ContextPacketBuilder,
  SOKO_BOT_CONTEXT_PACKET_MAX_BYTES,
} from "./context-packet";

const NOW = new Date("2026-08-18T10:00:00.000Z");
const EARLIER = new Date("2026-08-17T10:00:00.000Z");
const LATER = new Date("2026-08-19T10:00:00.000Z");

const CLASSIFICATION = {
  schemaVersion: 1 as const,
  route: "MANAGE_WORK" as const,
  confidence: 0.95,
  rationaleSummary: "User asked for status",
  requestedOutcome: "Summarize current work",
  candidateProjectIds: ["project-new"],
  candidateCoworkerIds: ["coworker-1"],
  candidateAgentIds: ["agent-1"],
  requiresClarification: false,
  requiresApproval: false,
};

function billingSummary() {
  return {
    subscription: {
      plan: "starter",
      status: "active",
      credits: { total: 100, remaining: 40, used: 60 },
    },
    extra: { enterprise: null },
    credits: { total: 50, buffer: 10 },
  };
}

function buildInput() {
  return {
    userId: "user-1",
    sokoBotId: "01960001-0001-7001-8001-000000000001",
    workspaceId: "01960001-0001-7001-8001-000000000002",
    source: "CHAT" as const,
    classification: CLASSIFICATION,
  };
}

function project(id: string, briefing = "Project summary") {
  return {
    id,
    name: `Project ${id}`,
    briefing,
    updatedAt: NOW,
    _count: { tasks: 0, jobs: 0 },
  };
}

function task(id: string, description = "Task summary") {
  return {
    id,
    name: `Task ${id}`,
    description,
    status: "RUNNING",
    projectId: "project-new",
    assigneeId: "coworker-1",
    nextRunAt: LATER,
    updatedAt: NOW,
    events: [{ status: "RUNNING", comment: "Working", createdAt: NOW }],
    linksTo: [],
    _count: { linksTo: 0 },
  };
}

function coworker(id: string, description = "Coworker summary") {
  return {
    id,
    name: `Coworker ${id}`,
    caption: "Project specialist",
    description,
    capabilities: ["tasks", "chat"],
    isWhitelisted: false,
    assignments: [],
    workspaceAccess: [{ status: "GRANTED" }],
    vendor: { vendorGrants: [{ status: "PENDING" }] },
  };
}

function agent(id: string, description = "Agent summary") {
  return {
    id,
    name: `Agent ${id}`,
    summary: description,
    description: null,
    capabilityName: "Research",
    paymentType: "WEB3_CARDANO_V1",
    riskClassification: "MINIMAL",
    pricing: {
      pricingType: "FIXED",
      fixedPricing: { amounts: [{ amount: 2n, unit: "lovelace" }] },
    },
  };
}

function job(id: string, inputSchema = null as string | null) {
  return {
    id,
    name: `Job ${id}`,
    agentId: "agent-1",
    jobType: "PAID",
    projectId: "project-new",
    updatedAt: NOW,
    transaction: { amount: -30_000_000_000n },
    events: [{ status: "AWAITING_INPUT", inputSchema, createdAt: EARLIER }],
  };
}

function pendingDecision(id: string, reason = "Approval needed") {
  return {
    id,
    toolName: "hire_agent",
    reason,
    expiresAt: LATER,
    createdAt: NOW,
  };
}

function recentTurn(
  id: string,
  userMessage = "What changed?",
  finalAnswer = "Project shipped",
) {
  return {
    id,
    source: "CHAT",
    status: "COMPLETED",
    route: "DIRECT_RESPONSE",
    userMessage,
    finalAnswer,
    createdAt: EARLIER,
    completedAt: NOW,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  transactionMock.mockImplementation(
    async (queries: readonly Promise<unknown>[]) => await Promise.all(queries),
  );
  workspaceFindFirstMock.mockResolvedValue({
    id: buildInput().workspaceId,
    userId: null,
    organizationId: "organization-1",
    organization: {
      name: "Example Org",
      members: [{ role: "owner" }],
    },
  });
  userFindUniqueMock.mockResolvedValue({ name: "Patrick Tobler" });
  userFindUniqueOrThrowMock.mockResolvedValue({
    id: "user-1",
    name: "Ada",
    metadata: JSON.stringify({ locale: "de-CH", timezone: "Europe/Zurich" }),
  });
  projectFindManyMock.mockResolvedValue([]);
  taskFindManyMock.mockResolvedValue([]);
  coworkerFindManyMock.mockResolvedValue([]);
  agentFindManyMock.mockResolvedValue([]);
  jobFindManyMock.mockResolvedValue([]);
  pendingDecisionFindManyMock.mockResolvedValue([]);
  recentTurnFindManyMock.mockResolvedValue([]);
  memoryFindFirstMock.mockResolvedValue(null);
  billingMock.mockResolvedValue(billingSummary());
  creditCostFindManyMock.mockResolvedValue([
    {
      id: "cost-1",
      createdAt: EARLIER,
      updatedAt: NOW,
      unit: "lovelace",
      centsPerUnit: 5_000_000_000n,
    },
  ]);
  projectCountMock.mockResolvedValue(0);
  taskCountMock.mockResolvedValue(0);
  coworkerCountMock.mockResolvedValue(0);
  agentCountMock.mockResolvedValue(0);
  jobCountMock.mockResolvedValue(0);
  pendingDecisionCountMock.mockResolvedValue(0);
  recentTurnCountMock.mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ContextPacketBuilder", () => {
  it("adds bounded operational, availability, pricing, input, and billing context", async () => {
    const blocker = {
      id: "blocker-1",
      name: "Dependency task",
      status: "RUNNING",
    };
    const runningTask = {
      ...task("task-running"),
      linksTo: [{ fromTask: blocker }],
      _count: { linksTo: 2 },
    };
    const completedTask = {
      ...task("task-completed"),
      status: "COMPLETED",
      events: [{ status: "COMPLETED", comment: "Done", createdAt: EARLIER }],
    };
    const currentProject = {
      ...project("project-new"),
      _count: { tasks: 2, jobs: 1 },
    };

    projectFindManyMock.mockResolvedValue([
      currentProject,
      project("project-old"),
    ]);
    taskFindManyMock.mockResolvedValue([runningTask, completedTask]);
    coworkerFindManyMock.mockResolvedValue([
      {
        ...coworker("coworker-1"),
        assignments: [{ id: "assignment-1" }],
      },
    ]);
    agentFindManyMock.mockResolvedValue([agent("agent-1")]);
    jobFindManyMock.mockResolvedValue([
      job("job-1", '{"input_data":[{"id":"brief","type":"string"}]}'),
    ]);
    pendingDecisionFindManyMock.mockResolvedValue([
      pendingDecision("decision-1"),
    ]);
    recentTurnFindManyMock.mockResolvedValue([
      recentTurn("turn-new", "Latest request", "Latest answer"),
      recentTurn("turn-old", "Earlier request", "Earlier answer"),
    ]);
    memoryFindFirstMock.mockResolvedValue({
      id: "memory-1",
      version: 3,
      hash: "memory-hash",
      markdown: "# Soko Bot memory\n\n## Active goals\n- Ship project",
    });
    projectCountMock.mockResolvedValue(2);
    taskCountMock.mockResolvedValue(2);
    coworkerCountMock.mockResolvedValue(1);
    agentCountMock.mockResolvedValue(1);
    jobCountMock.mockResolvedValue(1);
    pendingDecisionCountMock.mockResolvedValue(1);
    recentTurnCountMock.mockResolvedValue(2);

    const result = await new ContextPacketBuilder().build(buildInput());

    expect(result.packet.actor).toMatchObject({
      locale: "de-CH",
      timezone: "Europe/Zurich",
      workspaceId: buildInput().workspaceId,
    });
    expect(result.packet.workspace).toMatchObject({
      scope: "organization",
      plan: "starter",
      availableCredits: 50,
      bufferCredits: 10,
      subscriptionRemainingCredits: 40,
    });
    expect(result.packet.projects.map((item) => item.id)).toEqual([
      "project-new",
      "project-old",
    ]);
    expect(result.packet.projects[0]?.status).toEqual({
      taskCounts: { COMPLETED: 1, RUNNING: 1 },
      jobCounts: { AWAITING_INPUT: 1 },
      totalTasks: 2,
      totalJobs: 1,
      partial: false,
    });
    expect(result.packet.tasks[0]).toMatchObject({
      priority: null,
      dueAt: null,
      scheduledAt: LATER.toISOString(),
      blockedBy: [{ id: "blocker-1", status: "RUNNING" }],
      blockersOmitted: 1,
    });
    expect(result.packet.coworkers[0]).toMatchObject({
      availability: {
        available: true,
        globallyAvailable: false,
        assignedToUser: true,
        workspaceAccessStatus: "GRANTED",
      },
      vendorGrantStatus: "PENDING",
      pricing: null,
    });
    expect(result.packet.agents[0]).toMatchObject({
      inputRequirements: {
        source: "fetch-required",
        availableInContext: false,
      },
      price: {
        pricingType: "FIXED",
        credits: 1,
        maxCreditsRequired: true,
        minimumMaxCredits: 1,
      },
    });
    expect(result.packet.jobs[0]).toMatchObject({
      status: "AWAITING_INPUT",
      pendingInput: {
        required: true,
        schema: expect.stringContaining("brief"),
      },
      spentCredits: 3,
    });
    expect(result.packet.recentTurns).toMatchObject([
      { id: "turn-old", userMessage: "Earlier request" },
      { id: "turn-new", finalAnswer: "Latest answer" },
    ]);
    expect(memoryFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sokoBotId: buildInput().sokoBotId,
          sokoBot: { userId: "user-1" },
        },
      }),
    );
    expect(jobFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId: "user-1",
          workspaceId: buildInput().workspaceId,
        },
      }),
    );
  });

  it("redacts secrets from every untrusted text section", async () => {
    const secretValues = [
      "actor-secret",
      "project-secret",
      "task-secret",
      "event-secret",
      "coworker-secret",
      "agent-secret",
      "schema-secret",
      "decision-secret",
      "recent-turn-secret",
      "memory-secret-value",
      "outcome-secret",
      "billing-secret",
    ];
    userFindUniqueOrThrowMock.mockResolvedValue({
      id: "user-1",
      name: "token=actor-secret",
      metadata: null,
    });
    projectFindManyMock.mockResolvedValue([
      project("project-1", "api_key=project-secret"),
    ]);
    taskFindManyMock.mockResolvedValue([
      {
        ...task("task-1", "password: task-secret"),
        events: [
          {
            status: "RUNNING",
            comment: "token='event-secret'",
            createdAt: NOW,
          },
        ],
      },
    ]);
    coworkerFindManyMock.mockResolvedValue([
      coworker("coworker-1", "Bearer coworker-secret"),
    ]);
    agentFindManyMock.mockResolvedValue([
      agent("agent-1", "secret=agent-secret"),
    ]);
    jobFindManyMock.mockResolvedValue([
      job("job-1", '{"password":"schema-secret"}'),
    ]);
    pendingDecisionFindManyMock.mockResolvedValue([
      pendingDecision("decision-1", "api key: decision-secret"),
    ]);
    recentTurnFindManyMock.mockResolvedValue([
      recentTurn(
        "turn-1",
        "password=recent-turn-secret",
        "token=recent-turn-secret",
      ),
    ]);
    memoryFindFirstMock.mockResolvedValue({
      id: "memory-1",
      version: 1,
      hash: "hash",
      markdown: "# Memory\ntoken: memory-secret-value",
    });
    billingMock.mockResolvedValue({
      ...billingSummary(),
      subscription: {
        ...billingSummary().subscription,
        plan: "token=billing-secret",
      },
    });

    const input = buildInput();
    input.classification = {
      ...CLASSIFICATION,
      requestedOutcome: "password=outcome-secret",
    };
    const result = await new ContextPacketBuilder().build(input);
    const serialized = JSON.stringify(result.packet);

    for (const secret of secretValues) expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[Sensitive value removed]");
  });

  it("deterministically drops least-relevant tails under hard byte budget", async () => {
    const longText = "界".repeat(2_000);
    const blockers = Array.from({ length: 5 }, (_, index) => ({
      fromTask: {
        id: `blocker-${index}`,
        name: longText,
        status: "RUNNING",
      },
    }));
    projectFindManyMock.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) =>
        project(`project-${index}`, longText),
      ),
    );
    taskFindManyMock.mockResolvedValue(
      Array.from({ length: 24 }, (_, index) => ({
        ...task(`task-${index}`, longText),
        events: [{ status: "RUNNING", comment: longText, createdAt: NOW }],
        linksTo: blockers,
        _count: { linksTo: 5 },
      })),
    );
    coworkerFindManyMock.mockResolvedValue(
      Array.from({ length: 24 }, (_, index) => ({
        ...coworker(`coworker-${index}`, longText),
        capabilities: Array.from(
          { length: 20 },
          (__, capabilityIndex) => `${capabilityIndex}-${"x".repeat(300)}`,
        ),
      })),
    );
    agentFindManyMock.mockResolvedValue(
      Array.from({ length: 24 }, (_, index) =>
        agent(`agent-${index}`, longText),
      ),
    );
    jobFindManyMock.mockResolvedValue(
      Array.from({ length: 24 }, (_, index) => job(`job-${index}`, longText)),
    );
    pendingDecisionFindManyMock.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) =>
        pendingDecision(`decision-${index}`, longText),
      ),
    );
    memoryFindFirstMock.mockResolvedValue({
      id: "memory-1",
      version: 1,
      hash: "hash",
      markdown: longText.repeat(4),
    });
    projectCountMock.mockResolvedValue(100);
    taskCountMock.mockResolvedValue(100);
    coworkerCountMock.mockResolvedValue(100);
    agentCountMock.mockResolvedValue(100);
    jobCountMock.mockResolvedValue(100);
    pendingDecisionCountMock.mockResolvedValue(100);

    const builder = new ContextPacketBuilder();
    const first = await builder.build(buildInput());
    const second = await builder.build(buildInput());

    expect(first.byteSize).toBeLessThanOrEqual(
      SOKO_BOT_CONTEXT_PACKET_MAX_BYTES,
    );
    expect(Buffer.byteLength(JSON.stringify(first.packet), "utf8")).toBe(
      first.byteSize,
    );
    expect(first.packet.hash).toBe(second.packet.hash);
    expect(first.packet).toEqual(second.packet);
    expect(
      Object.values(first.omissions).reduce((sum, count) => sum + count, 0),
    ).toBeGreaterThan(480);

    for (const key of [
      "projects",
      "tasks",
      "coworkers",
      "agents",
      "jobs",
      "pendingDecisions",
      "recentTurns",
    ] as const) {
      const collection = first.packet[key];
      if (collection.length > 0) expect(collection[0]?.id).toContain("-0");
    }
  });

  it("withholds the owner's private surfaces from a teammate turn", async () => {
    // A teammate mention runs as the owner and answers into the shared room,
    // so the packet must not carry what only the owner should see.
    pendingDecisionFindManyMock.mockResolvedValue([
      pendingDecision("decision-1"),
    ]);
    recentTurnFindManyMock.mockResolvedValue([
      recentTurn("turn-new", "Private request", "Private answer"),
    ]);
    memoryFindFirstMock.mockResolvedValue({
      id: "memory-1",
      version: 3,
      hash: "memory-hash",
      markdown: "# Soko Bot memory\n\n## Active goals\n- Ship the secret",
    });

    const result = await new ContextPacketBuilder().build({
      ...buildInput(),
      audience: "TEAMMATE" as const,
    });
    const serialized = JSON.stringify(result.packet);

    expect(result.packet.memory.markdown).toBe("# Soko Bot memory");
    expect(result.packet.memory.version).toBe(0);
    expect(result.packet.recentTurns).toEqual([]);
    expect(result.packet.pendingDecisions).toEqual([]);
    expect(result.packet.workspace.availableCredits).toBeNull();
    expect(serialized).not.toContain("Ship the secret");
    expect(serialized).not.toContain("Private answer");
  });

  it("names the colleague who asked, not the owner the turn runs as", async () => {
    // `actor` is the owner on every turn, so without this the packet asserts
    // the owner is the one speaking and the bot greets them by name at
    // somebody else.
    const result = await new ContextPacketBuilder().build({
      ...buildInput(),
      audience: "TEAMMATE" as const,
      askedByKind: "TEAMMATE" as const,
      askedByUserId: "user-2",
    });

    expect(result.packet.trigger.askedBy).toEqual({
      kind: "TEAMMATE",
      name: "Patrick Tobler",
      trust: "untrusted-data",
    });
    expect(result.packet.actor.name).toBe("Ada");
  });

  it("names the owner when the owner is the one asking", async () => {
    const result = await new ContextPacketBuilder().build(buildInput());

    expect(result.packet.trigger.askedBy).toEqual({
      kind: "OWNER",
      name: "Ada",
      trust: "untrusted-data",
    });
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("treats the owner asking under their own id as the owner", async () => {
    // The dispatch path passes the asker's id even when it is the owner's.
    const result = await new ContextPacketBuilder().build({
      ...buildInput(),
      askedByUserId: "user-1",
    });

    expect(result.packet.trigger.askedBy.kind).toBe("OWNER");
    expect(result.packet.trigger.askedBy.name).toBe("Ada");
  });

  it("gives no name for a colleague whose account is gone", async () => {
    // Falling back to the owner's name here would say the owner is the one
    // asking, which is the confusion this field exists to end.
    userFindUniqueMock.mockResolvedValue(null);

    const result = await new ContextPacketBuilder().build({
      ...buildInput(),
      audience: "TEAMMATE" as const,
      askedByKind: "TEAMMATE" as const,
      askedByUserId: "user-gone",
    });

    expect(result.packet.trigger.askedBy).toEqual({
      kind: "TEAMMATE",
      name: null,
      trust: "untrusted-data",
    });
  });

  it("leaves another assistant nameless rather than naming its owner", async () => {
    // The only id behind a bot-to-bot question is the *sending* bot's owner,
    // who is not in the conversation. Naming them would tell this bot it was
    // talking to a colleague who never said anything.
    const result = await new ContextPacketBuilder().build({
      ...buildInput(),
      audience: "TEAMMATE" as const,
      askedByKind: "ASSISTANT" as const,
      askedByUserId: "user-2",
    });

    expect(result.packet.trigger.askedBy).toEqual({
      kind: "ASSISTANT",
      name: null,
      trust: "untrusted-data",
    });
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("keeps the owner's own turn complete", async () => {
    recentTurnFindManyMock.mockResolvedValue([
      recentTurn("turn-new", "Owner request", "Owner answer"),
    ]);
    memoryFindFirstMock.mockResolvedValue({
      id: "memory-1",
      version: 3,
      hash: "memory-hash",
      markdown: "# Soko Bot memory\n\n## Active goals\n- Ship the project",
    });

    const result = await new ContextPacketBuilder().build(buildInput());

    expect(result.packet.memory.version).toBe(3);
    expect(result.packet.recentTurns).toHaveLength(1);
  });
});
