import { Channel, GrantResumeStatus, TaskStatus } from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import type { TaskWithIncludes } from "@/types/task";

import {
  getTaskStatusUpdateDataForEvent,
  mapTask,
  mapTaskEvent,
  mapTaskEventActor,
  mapTaskFile,
  taskAssigneeKind,
  validateQueuedRequiresSchedule,
  validateStatusTransition,
  validateTaskAssigneeAssignment,
} from "./task";

const defaultTaskUser = {
  id: "user_123",
  name: "Test User",
  image: null,
};

const defaultTaskCoworker = {
  id: "cow_123",
  name: "Test Coworker",
  image: null,
  slug: "test-coworker",
};

const defaultNestedJobUserOrg = {
  ownerId: "user_123",
  owner: defaultTaskUser,
  // Deprecated aliases kept for dual-emit fixture coverage.
  userId: "user_123",
  user: defaultTaskUser,
  organization: null as { id: string; name: string; slug: string } | null,
};

describe("validateStatusTransition", () => {
  it("rejects same-status transition", () => {
    expect(() => {
      validateStatusTransition(TaskStatus.RUNNING, TaskStatus.RUNNING);
    }).toThrow("Invalid status transition: same status");
  });

  it.each([
    [TaskStatus.DRAFT, TaskStatus.READY],
    [TaskStatus.READY, TaskStatus.RUNNING],
    [TaskStatus.RUNNING, TaskStatus.COMPLETED],
    [TaskStatus.COMPLETED, TaskStatus.READY],
    [TaskStatus.COMPLETED, TaskStatus.RUNNING],
    [TaskStatus.CANCELED, TaskStatus.READY],
    [TaskStatus.CANCELED, TaskStatus.RUNNING],
    [TaskStatus.FAILED, TaskStatus.READY],
    [TaskStatus.QUEUED, TaskStatus.COMPLETED],
    [TaskStatus.READY, TaskStatus.OUT_OF_CREDITS],
    [TaskStatus.OUT_OF_CREDITS, TaskStatus.CREDITS_TOPPED_UP],
    [TaskStatus.INPUT_REQUIRED, TaskStatus.RUNNING],
    [TaskStatus.DRAFT, TaskStatus.QUEUED],
  ])("allows free transition %s → %s", (from, to) => {
    expect(() => validateStatusTransition(from, to)).not.toThrow();
  });
});

describe("task cancel helpers", () => {
  it("clears schedule fields when canceling", () => {
    expect(getTaskStatusUpdateDataForEvent(TaskStatus.CANCELED)).toEqual({
      status: TaskStatus.CANCELED,
      metadata: null,
      nextRunAt: null,
    });
    expect(getTaskStatusUpdateDataForEvent(TaskStatus.READY)).toEqual({
      status: TaskStatus.READY,
    });
  });
});

describe("schedule series lifecycle helpers", () => {
  it("no longer exposes schedule cascade helpers", async () => {
    const taskHelpers = await import("./task");

    expect(taskHelpers).not.toHaveProperty(
      "cascadeCancelNonTerminalScheduleRuns",
    );
    expect(taskHelpers).not.toHaveProperty(
      "cascadeArchiveScheduleParentChildren",
    );
    expect(taskHelpers).not.toHaveProperty("isTerminalTaskStatus");
  });
});

describe("validateTaskAssigneeAssignment", () => {
  it("resolves coworker, human, and unset kinds", () => {
    expect(taskAssigneeKind({ assigneeId: "cow_1" })).toBe("coworker");
    expect(
      taskAssigneeKind({ assigneeId: null, assigneeUserId: "user_1" }),
    ).toBe("human");
    expect(taskAssigneeKind({ assigneeId: null, assigneeUserId: null })).toBe(
      "unset",
    );
  });

  it("allows DRAFT tasks without a coworker", () => {
    expect(() =>
      validateTaskAssigneeAssignment({
        status: TaskStatus.DRAFT,
        assigneeId: null,
      }),
    ).not.toThrow();
  });

  it("allows CANCELED tasks without a coworker", () => {
    expect(() =>
      validateTaskAssigneeAssignment({
        status: TaskStatus.CANCELED,
        assigneeId: null,
      }),
    ).not.toThrow();
  });

  it("allows non-DRAFT tasks with a coworker", () => {
    expect(() =>
      validateTaskAssigneeAssignment({
        status: TaskStatus.READY,
        assigneeId: "cow_123",
      }),
    ).not.toThrow();
  });

  it("allows QUEUED tasks with a coworker", () => {
    expect(() =>
      validateTaskAssigneeAssignment({
        status: TaskStatus.QUEUED,
        assigneeId: "cow_123",
      }),
    ).not.toThrow();
  });

  it("rejects QUEUED without an active schedule", () => {
    expect(() =>
      validateQueuedRequiresSchedule({
        status: TaskStatus.QUEUED,
        metadata: null,
        nextRunAt: null,
      }),
    ).toThrow("A schedule is required before moving a task to Queued");
  });

  it("allows QUEUED when nextRunAt is set", () => {
    expect(() =>
      validateQueuedRequiresSchedule({
        status: TaskStatus.QUEUED,
        metadata: null,
        nextRunAt: new Date("2099-01-01T09:00:00.000Z"),
      }),
    ).not.toThrow();
  });

  it("ignores non-QUEUED statuses for the schedule guard", () => {
    expect(() =>
      validateQueuedRequiresSchedule({
        status: TaskStatus.READY,
        metadata: null,
        nextRunAt: null,
      }),
    ).not.toThrow();
  });

  it("allows READY tasks unset (SOK-868)", () => {
    expect(() =>
      validateTaskAssigneeAssignment({
        status: TaskStatus.READY,
        assigneeId: null,
        assigneeUserId: null,
      }),
    ).not.toThrow();
  });

  it("rejects QUEUED tasks without an agent assignee", () => {
    expect(() =>
      validateTaskAssigneeAssignment({
        status: TaskStatus.QUEUED,
        assigneeId: null,
      }),
    ).toThrow();
  });

  it("rejects QUEUED tasks with only a human assignee", () => {
    expect(() =>
      validateTaskAssigneeAssignment({
        status: TaskStatus.QUEUED,
        assigneeId: null,
        assigneeUserId: "user_123",
      }),
    ).toThrow();
  });

  it("rejects more than one assignee", () => {
    expect(() =>
      validateTaskAssigneeAssignment({
        status: TaskStatus.READY,
        assigneeId: "cow_123",
        assigneeUserId: "user_123",
      }),
    ).toThrow();
  });

  it("allows non-DRAFT tasks with empty assigneeId at invariant layer", () => {
    expect(() =>
      validateTaskAssigneeAssignment({
        status: TaskStatus.READY,
        assigneeId: "   ",
      }),
    ).not.toThrow();
  });
});

function buildTaskEventFixture(
  overrides: Record<string, unknown> = {},
): Parameters<typeof mapTaskEvent>[0] {
  return {
    id: "evt_123",
    taskId: "tsk_123",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    status: TaskStatus.RUNNING,
    scheduleKind: null,
    schedulePayload: null,
    scheduleOperationId: null,
    comment: null,
    authenticationUrl: null,
    channel: Channel.SOKOSUMI,
    userId: null,
    coworkerId: null,
    sokoBotId: null,
    transactionId: null,
    cents: null,
    user: null,
    coworker: null,
    sokoBot: null,
    ...overrides,
  };
}

describe("mapTaskEventActor", () => {
  it("maps a user actor", () => {
    const event = buildTaskEventFixture({
      userId: "user_123",
      user: defaultTaskUser,
    });

    expect(mapTaskEventActor(event)).toEqual({
      type: "user",
      id: "user_123",
      user: defaultTaskUser,
    });
  });

  it("maps a coworker actor", () => {
    const event = buildTaskEventFixture({
      coworkerId: "cow_123",
      coworker: defaultTaskCoworker,
    });

    expect(mapTaskEventActor(event)).toEqual({
      type: "coworker",
      id: "cow_123",
      coworker: defaultTaskCoworker,
    });
  });

  it("maps a soko bot actor", () => {
    const sokoBot = {
      id: "01960001-0001-7001-8001-000000000099",
      name: "Hermes",
      avatarSeed: "orb:jewel-sky:user_123",
      userId: defaultTaskUser.id,
      user: defaultTaskUser,
    };
    const event = buildTaskEventFixture({
      sokoBotId: sokoBot.id,
      sokoBot: sokoBot,
    });

    expect(mapTaskEventActor(event)).toEqual({
      type: "sokoBot",
      id: sokoBot.id,
      sokoBot: {
        id: sokoBot.id,
        name: sokoBot.name,
        avatarSeed: sokoBot.avatarSeed,
        owner: defaultTaskUser,
      },
    });
  });

  it("returns null when no actor FK is set", () => {
    expect(mapTaskEventActor(buildTaskEventFixture())).toBeNull();
  });

  it("prefers coworker over user for legacy multi-FK rows", () => {
    expect(
      mapTaskEventActor(
        buildTaskEventFixture({
          userId: "user_123",
          user: defaultTaskUser,
          coworkerId: "cow_123",
          coworker: defaultTaskCoworker,
        }),
      ),
    ).toEqual({
      type: "coworker",
      id: "cow_123",
      coworker: defaultTaskCoworker,
    });
  });

  it("prefers soko bot over user for legacy multi-FK rows", () => {
    const sokoBot = {
      id: "01960001-0001-7001-8001-000000000099",
      name: "Hermes",
      avatarSeed: null,
      userId: defaultTaskUser.id,
      user: defaultTaskUser,
    };

    expect(
      mapTaskEventActor(
        buildTaskEventFixture({
          userId: "user_123",
          user: defaultTaskUser,
          sokoBotId: sokoBot.id,
          sokoBot: sokoBot,
        }),
      ),
    ).toEqual({
      type: "sokoBot",
      id: sokoBot.id,
      sokoBot: {
        id: sokoBot.id,
        name: sokoBot.name,
        avatarSeed: sokoBot.avatarSeed,
        owner: defaultTaskUser,
      },
    });
  });

  it("prefers soko bot over coworker for legacy multi-FK rows", () => {
    const sokoBot = {
      id: "01960001-0001-7001-8001-000000000099",
      name: "Hermes",
      avatarSeed: null,
      userId: defaultTaskUser.id,
      user: defaultTaskUser,
    };

    expect(
      mapTaskEventActor(
        buildTaskEventFixture({
          coworkerId: "cow_123",
          coworker: defaultTaskCoworker,
          sokoBotId: sokoBot.id,
          sokoBot: sokoBot,
        }),
      ),
    ).toEqual({
      type: "sokoBot",
      id: sokoBot.id,
      sokoBot: {
        id: sokoBot.id,
        name: sokoBot.name,
        avatarSeed: sokoBot.avatarSeed,
        owner: defaultTaskUser,
      },
    });
  });

  it("throws when a single actor FK is set without the loaded relation", () => {
    expect(() =>
      mapTaskEventActor(
        buildTaskEventFixture({
          userId: "user_123",
          user: null,
        }),
      ),
    ).toThrow(/user relation must be loaded/);
  });
});

describe("mapTaskEvent", () => {
  it("includes nested actor and deprecated flat aliases", () => {
    const event = buildTaskEventFixture({
      userId: "user_123",
      user: defaultTaskUser,
    });

    expect(mapTaskEvent(event)).toMatchObject({
      actor: {
        type: "user",
        id: "user_123",
        user: defaultTaskUser,
      },
      userId: "user_123",
      user: defaultTaskUser,
    });
  });

  it("exposes actor null without flat aliases when no actor FK is set", () => {
    expect(mapTaskEvent(buildTaskEventFixture())).toMatchObject({
      actor: null,
    });
    expect(mapTaskEvent(buildTaskEventFixture())).not.toHaveProperty("user");
    expect(mapTaskEvent(buildTaskEventFixture())).not.toHaveProperty(
      "coworker",
    );
    expect(mapTaskEvent(buildTaskEventFixture())).not.toHaveProperty("sokoBot");
  });

  it("keeps all flat FKs but only preferred summary on legacy multi-FK rows", () => {
    const mapped = mapTaskEvent(
      buildTaskEventFixture({
        userId: "user_123",
        user: defaultTaskUser,
        coworkerId: "cow_123",
        coworker: defaultTaskCoworker,
      }),
    );

    expect(mapped).toMatchObject({
      actor: {
        type: "coworker",
        id: "cow_123",
        coworker: defaultTaskCoworker,
      },
      userId: "user_123",
      coworkerId: "cow_123",
      coworker: defaultTaskCoworker,
    });
    expect(mapped).not.toHaveProperty("user");
    expect(mapped).not.toHaveProperty("sokoBot");
  });
});

describe("mapTask", () => {
  it("preserves the raw share relation for schema parsing to shape later", () => {
    const share = {
      id: "share_123",
      token: "public-share-token",
      allowSearchIndexing: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      jobId: null,
      taskId: "tsk_123",
    };
    const task = {
      id: "tsk_123",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ownerId: "user_123",
      organizationId: null,
      owner: defaultTaskUser,
      organization: null,
      assigneeId: "cow_123",
      assignee: defaultTaskCoworker,
      creatorUserId: "user_123",
      creatorUser: defaultTaskUser,
      creatorCoworkerId: null,
      creatorCoworker: null,
      creatorSokoBotId: null,
      creatorSokoBot: null,
      name: "Task with share",
      description: null,
      status: TaskStatus.READY,
      share,
      jobs: [],
      files: [],
      linksFrom: [],
      linksTo: [],
      events: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
    } as unknown as TaskWithIncludes;

    const result = mapTask(task);

    expect(result.share).toEqual(share);
  });

  it("exposes grant fields only while status is GRANT_PENDING", () => {
    const grantId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const parkedTask = {
      id: "tsk_parked",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ownerId: "user_123",
      organizationId: null,
      owner: defaultTaskUser,
      organization: null,
      assigneeId: "cow_123",
      assignee: defaultTaskCoworker,
      creatorUserId: "user_123",
      creatorUser: defaultTaskUser,
      creatorCoworkerId: null,
      creatorCoworker: null,
      creatorSokoBotId: null,
      creatorSokoBot: null,
      name: "Parked task",
      description: null,
      status: TaskStatus.GRANT_PENDING,
      grantResumeStatus: GrantResumeStatus.READY,
      pendingVendorGrantId: grantId,
      share: null,
      jobs: [],
      files: [],
      linksFrom: [],
      linksTo: [],
      events: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
    } as unknown as TaskWithIncludes;

    const readyTask = {
      ...parkedTask,
      id: "tsk_ready",
      status: TaskStatus.READY,
      grantResumeStatus: GrantResumeStatus.READY,
      pendingVendorGrantId: grantId,
    } as unknown as TaskWithIncludes;

    expect(mapTask(parkedTask)).toMatchObject({
      status: TaskStatus.GRANT_PENDING,
      grantResumeStatus: GrantResumeStatus.READY,
      pendingVendorGrantId: grantId,
    });
    expect(mapTask(readyTask)).toMatchObject({
      status: TaskStatus.READY,
      grantResumeStatus: null,
      pendingVendorGrantId: null,
    });
  });

  it("maps a soko bot assignee from assigneeSokoBotId", () => {
    const assigneeSokoBot = {
      id: "01960001-0001-7001-8001-000000000099",
      name: "Soko Bot",
      avatarSeed: null,
      avatarImageUrl: null,
      userId: defaultTaskUser.id,
      user: defaultTaskUser,
    };
    const task = {
      id: "tsk_pa_assignee",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ownerId: "user_123",
      organizationId: null,
      owner: defaultTaskUser,
      organization: null,
      assigneeId: null,
      assignee: null,
      assigneeSokoBotId: assigneeSokoBot.id,
      assigneeSokoBot,
      creatorUserId: "user_123",
      creatorUser: defaultTaskUser,
      creatorCoworkerId: null,
      creatorCoworker: null,
      creatorSokoBotId: null,
      creatorSokoBot: null,
      name: "PA assigned task",
      description: null,
      status: TaskStatus.READY,
      share: null,
      jobs: [],
      files: [],
      linksFrom: [],
      linksTo: [],
      events: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
    } as unknown as TaskWithIncludes;

    expect(mapTask(task)).toMatchObject({
      assigneeId: null,
      assigneeSokoBotId: assigneeSokoBot.id,
      coworkerId: null,
      coworker: null,
      assignee: {
        type: "sokoBot",
        id: assigneeSokoBot.id,
        sokoBot: {
          id: assigneeSokoBot.id,
          name: assigneeSokoBot.name,
          avatarSeed: null,
          avatarImageUrl: null,
          owner: defaultTaskUser,
        },
      },
    });
  });

  it("maps nested creator and deprecated owner/assignee/soko bot aliases", () => {
    const creatorSokoBot = {
      id: "01960001-0001-7001-8001-000000000099",
      name: "Hermes",
      avatarSeed: null,
      userId: defaultTaskUser.id,
      user: defaultTaskUser,
    };
    const task = {
      id: "tsk_alias",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ownerId: "user_123",
      organizationId: null,
      owner: defaultTaskUser,
      organization: null,
      assigneeId: "cow_123",
      assignee: defaultTaskCoworker,
      creatorUserId: null,
      creatorUser: null,
      creatorCoworkerId: null,
      creatorCoworker: null,
      creatorSokoBotId: creatorSokoBot.id,
      creatorSokoBot,
      name: "Alias task",
      description: null,
      status: TaskStatus.READY,
      share: null,
      jobs: [],
      files: [],
      linksFrom: [],
      linksTo: [],
      events: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
    } as unknown as TaskWithIncludes;

    const mappedSokoBot = {
      id: creatorSokoBot.id,
      name: creatorSokoBot.name,
      avatarSeed: creatorSokoBot.avatarSeed,
      owner: defaultTaskUser,
    };

    expect(mapTask(task)).toMatchObject({
      ownerId: "user_123",
      userId: "user_123",
      user: defaultTaskUser,
      assigneeId: "cow_123",
      coworkerId: "cow_123",
      coworker: defaultTaskCoworker,
      creator: {
        type: "sokoBot",
        id: creatorSokoBot.id,
        sokoBot: mappedSokoBot,
      },
      sokoBotId: creatorSokoBot.id,
      sokoBot: mappedSokoBot,
    });
  });

  it("serializes nested job workspaces", () => {
    const task = {
      id: "tsk_123",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ownerId: "user_123",
      organizationId: null,
      owner: defaultTaskUser,
      organization: null,
      assigneeId: "cow_123",
      assignee: defaultTaskCoworker,
      creatorUserId: "user_123",
      creatorUser: defaultTaskUser,
      creatorCoworkerId: null,
      creatorCoworker: null,
      creatorSokoBotId: null,
      creatorSokoBot: null,
      name: "Task with job",
      description: null,
      status: TaskStatus.READY,
      share: null,
      linksFrom: [],
      linksTo: [],
      files: [],
      events: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
      jobs: [
        {
          id: "job_123",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          agentId: "agent_123",
          organizationId: null,
          taskId: "tsk_123",
          name: "Job",
          jobType: "FREE",
          completedAt: null,
          result: null,
          resultHash: null,
          workspace: {
            id: "22222222-2222-7222-8222-222222222222",
            organizationId: "org_123",
            organization: {
              id: "org_123",
              name: "Workspace Org",
              slug: "workspace-org",
            },
          },
          purchase: null,
          transaction: null,
          events: [],
          ...defaultNestedJobUserOrg,
        },
      ],
    } as unknown as TaskWithIncludes;

    const result = mapTask(task);

    expect(result.jobs[0]?.workspace).toEqual({
      id: "22222222-2222-7222-8222-222222222222",
      organizationId: "org_123",
      organization: {
        id: "org_123",
        name: "Workspace Org",
        slug: "workspace-org",
      },
    });
  });

  it("aggregates credits from multiple charged events (historical rows)", () => {
    const task = {
      id: "tsk_123",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ownerId: "user_123",
      organizationId: null,
      owner: defaultTaskUser,
      organization: null,
      assigneeId: "cow_123",
      assignee: defaultTaskCoworker,
      creatorUserId: "user_123",
      creatorUser: defaultTaskUser,
      creatorCoworkerId: null,
      creatorCoworker: null,
      creatorSokoBotId: null,
      creatorSokoBot: null,
      name: "Task with retries",
      description: null,
      status: TaskStatus.COMPLETED,
      share: null,
      jobs: [],
      files: [],
      linksFrom: [],
      linksTo: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
      events: [
        {
          id: "evt_cancel",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          status: TaskStatus.CANCELED,
          comment: null,
          authenticationUrl: null,
          channel: Channel.SOKOSUMI,
          userId: null,
          coworkerId: "cow_123",
          transactionId: "txn_cancel",
          cents: convertCreditsToCents(2),
          user: null,
          coworker: defaultTaskCoworker,
          transaction: {
            amount: convertCreditsToCents(2) * -1n,
          },
        },
        {
          id: "evt_ready",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:01:00.000Z"),
          updatedAt: new Date("2026-01-01T00:01:00.000Z"),
          status: TaskStatus.READY,
          comment: null,
          authenticationUrl: null,
          channel: Channel.SOKOSUMI,
          userId: "user_123",
          coworkerId: null,
          transactionId: null,
          cents: null,
          transaction: null,
          user: defaultTaskUser,
        },
        {
          id: "evt_complete",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:02:00.000Z"),
          updatedAt: new Date("2026-01-01T00:02:00.000Z"),
          status: TaskStatus.COMPLETED,
          comment: null,
          authenticationUrl: null,
          channel: Channel.SOKOSUMI,
          userId: null,
          coworkerId: "cow_123",
          transactionId: "txn_complete",
          cents: convertCreditsToCents(3),
          coworker: defaultTaskCoworker,
          transaction: {
            amount: convertCreditsToCents(3) * -1n,
          },
          user: null,
        },
      ],
    } as unknown as TaskWithIncludes;

    const result = mapTask(task);

    expect(result.credits).toBe(5);
    expect(result.events).toHaveLength(3);
    expect(result.events[0]?.credits).toBe(2);
    expect(result.events[1]?.credits).toBeNull();
    expect(result.events[2]?.credits).toBe(3);
  });

  it("excludes CREDITS_TOPPED_UP event credits from task total", () => {
    const task = {
      id: "tsk_123",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ownerId: "user_123",
      organizationId: null,
      owner: defaultTaskUser,
      organization: null,
      assigneeId: "cow_123",
      assignee: defaultTaskCoworker,
      creatorUserId: "user_123",
      creatorUser: defaultTaskUser,
      creatorCoworkerId: null,
      creatorCoworker: null,
      creatorSokoBotId: null,
      creatorSokoBot: null,
      name: "Task with top-up",
      description: null,
      status: TaskStatus.COMPLETED,
      share: null,
      jobs: [],
      files: [],
      linksFrom: [],
      linksTo: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
      events: [
        {
          id: "evt_complete",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          status: TaskStatus.COMPLETED,
          comment: null,
          authenticationUrl: null,
          channel: Channel.SOKOSUMI,
          userId: null,
          coworkerId: "cow_123",
          transactionId: "txn_complete",
          cents: convertCreditsToCents(3),
          user: null,
          coworker: defaultTaskCoworker,
          transaction: { amount: convertCreditsToCents(3) * -1n },
        },
        {
          id: "evt_topup",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:01:00.000Z"),
          updatedAt: new Date("2026-01-01T00:01:00.000Z"),
          status: TaskStatus.CREDITS_TOPPED_UP,
          comment: null,
          authenticationUrl: null,
          channel: Channel.SOKOSUMI,
          userId: "user_123",
          coworkerId: null,
          transactionId: null,
          cents: convertCreditsToCents(10),
          transaction: null,
          user: defaultTaskUser,
        },
      ],
    } as unknown as TaskWithIncludes;

    const result = mapTask(task);

    expect(result.credits).toBe(3);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]?.credits).toBe(3);
    expect(result.events[1]?.credits).toBe(10);
  });

  it("ignores OUT_OF_CREDITS attempt-only cents in task credit total", () => {
    const task = {
      id: "tsk_123",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ownerId: "user_123",
      organizationId: null,
      owner: defaultTaskUser,
      organization: null,
      assigneeId: "cow_123",
      assignee: defaultTaskCoworker,
      creatorUserId: "user_123",
      creatorUser: defaultTaskUser,
      creatorCoworkerId: null,
      creatorCoworker: null,
      creatorSokoBotId: null,
      creatorSokoBot: null,
      name: "Task with pause attempt",
      description: null,
      status: TaskStatus.OUT_OF_CREDITS,
      share: null,
      jobs: [],
      files: [],
      linksFrom: [],
      linksTo: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
      events: [
        {
          id: "evt_settled",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          status: TaskStatus.RUNNING,
          comment: null,
          authenticationUrl: null,
          channel: Channel.SOKOSUMI,
          userId: null,
          coworkerId: "cow_123",
          transactionId: "txn_settled",
          cents: convertCreditsToCents(2),
          user: null,
          coworker: defaultTaskCoworker,
          transaction: {
            amount: convertCreditsToCents(2) * -1n,
          },
        },
        {
          id: "evt_attempt",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:01:00.000Z"),
          updatedAt: new Date("2026-01-01T00:01:00.000Z"),
          status: TaskStatus.OUT_OF_CREDITS,
          comment: null,
          authenticationUrl: null,
          channel: Channel.SOKOSUMI,
          userId: null,
          coworkerId: "cow_123",
          transactionId: null,
          cents: convertCreditsToCents(7),
          user: null,
          coworker: defaultTaskCoworker,
          transaction: null,
        },
      ],
    } as unknown as TaskWithIncludes;

    const result = mapTask(task);

    expect(result.credits).toBe(2);
    expect(result.events[0]?.credits).toBe(2);
    expect(result.events[1]?.credits).toBe(7);
  });

  it("aggregates consumed transaction credits for out-of-credits fallback events", () => {
    const task = {
      id: "tsk_123",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ownerId: "user_123",
      organizationId: null,
      owner: defaultTaskUser,
      organization: null,
      assigneeId: "cow_123",
      assignee: defaultTaskCoworker,
      creatorUserId: "user_123",
      creatorUser: defaultTaskUser,
      creatorCoworkerId: null,
      creatorCoworker: null,
      creatorSokoBotId: null,
      creatorSokoBot: null,
      name: "Task with partial charge",
      description: null,
      status: TaskStatus.OUT_OF_CREDITS,
      share: null,
      jobs: [],
      files: [],
      linksFrom: [],
      linksTo: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
      events: [
        {
          id: "evt_partial",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          status: TaskStatus.OUT_OF_CREDITS,
          comment: null,
          authenticationUrl: null,
          channel: Channel.SOKOSUMI,
          userId: null,
          coworkerId: "cow_123",
          transactionId: "txn_partial",
          cents: convertCreditsToCents(5),
          user: null,
          coworker: defaultTaskCoworker,
          transaction: {
            amount: convertCreditsToCents(2) * -1n,
          },
        },
      ],
    } as unknown as TaskWithIncludes;

    const result = mapTask(task);

    expect(result.credits).toBe(2);
    expect(result.events[0]?.credits).toBe(5);
  });
});

describe("mapTaskFile", () => {
  it("maps user and coworker uploaders and coerces size to number", () => {
    const createdAt = new Date("2026-01-02T00:00:00.000Z");
    const updatedAt = new Date("2026-01-02T00:00:00.000Z");

    const userUploaded = mapTaskFile({
      id: "tfile_user",
      taskId: "tsk_123",
      createdAt,
      updatedAt,
      name: "report.pdf",
      fileUrl: "https://blob.example.com/tasks/tsk_123/report.pdf",
      sourceUrl: null,
      mimeType: "application/pdf",
      size: 2048n,
      status: "READY",
      origin: "USER_UPLOAD",
      uploadedByUserId: "user_123",
      uploadedByUser: defaultTaskUser,
      uploadedByCoworkerId: null,
      uploadedByCoworker: null,
    } as unknown as Parameters<typeof mapTaskFile>[0]);

    expect(userUploaded).toEqual({
      id: "tfile_user",
      taskId: "tsk_123",
      createdAt,
      updatedAt,
      name: "report.pdf",
      fileUrl: "https://blob.example.com/tasks/tsk_123/report.pdf",
      mimeType: "application/pdf",
      size: 2048,
      status: "READY",
      origin: "USER_UPLOAD",
      sourceUrl: null,
      uploader: {
        type: "user",
        id: "user_123",
        user: defaultTaskUser,
      },
    });

    const coworkerUploaded = mapTaskFile({
      id: "tfile_cow",
      taskId: "tsk_123",
      createdAt,
      updatedAt,
      name: "notes.txt",
      fileUrl: "https://blob.example.com/tasks/tsk_123/notes.txt",
      sourceUrl: null,
      mimeType: "text/plain",
      size: null,
      status: "READY",
      origin: "TASK_OUTPUT",
      uploadedByUserId: null,
      uploadedByUser: null,
      uploadedByCoworkerId: "cow_123",
      uploadedByCoworker: defaultTaskCoworker,
    } as unknown as Parameters<typeof mapTaskFile>[0]);

    expect(coworkerUploaded).toEqual({
      id: "tfile_cow",
      taskId: "tsk_123",
      createdAt,
      updatedAt,
      name: "notes.txt",
      fileUrl: "https://blob.example.com/tasks/tsk_123/notes.txt",
      mimeType: "text/plain",
      size: null,
      status: "READY",
      origin: "TASK_OUTPUT",
      sourceUrl: null,
      uploader: {
        type: "coworker",
        id: "cow_123",
        coworker: defaultTaskCoworker,
      },
    });
  });
});
