import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  targetResolverEnabled: false,
}));

const db = vi.hoisted(() => ({
  turnFindUnique: vi.fn(),
  projectFindMany: vi.fn(),
  projectFindUnique: vi.fn(),
  connectionFindMany: vi.fn(),
  newsletterFindMany: vi.fn(),
  socialPostFindFirst: vi.fn(),
  socialPostFindMany: vi.fn(),
  sokoBotScheduleFindMany: vi.fn(),
  sokoBotScheduleFindFirst: vi.fn(),
  taskScheduleFindFirst: vi.fn(),
}));

vi.mock("@sokosumi/soko-bot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sokosumi/soko-bot")>();
  return {
    ...actual,
    getSokoBotVersion: vi.fn((id: string | null | undefined) => {
      const base = actual.getSokoBotVersion(id);
      return state.targetResolverEnabled
        ? { ...base, targetResolver: true as const }
        : base;
    }),
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findUnique: db.turnFindUnique },
    project: {
      findMany: db.projectFindMany,
      findUnique: db.projectFindUnique,
    },
    projectSocialConnection: { findMany: db.connectionFindMany },
    newsletter: { findMany: db.newsletterFindMany },
    socialPost: {
      findFirst: db.socialPostFindFirst,
      findMany: db.socialPostFindMany,
    },
    sokoBotSchedule: {
      findMany: db.sokoBotScheduleFindMany,
      findFirst: db.sokoBotScheduleFindFirst,
    },
    taskSchedule: { findFirst: db.taskScheduleFindFirst },
  },
}));

import type { AuthorizedSokoBotRuntime } from "@/services/soko-bot-runtime.service";
import {
  namedProjectsByTargetResolver,
  namedSocialDestinationsByTargetResolver,
} from "./ask-policy-match";
import {
  buildSchedulesTargetResolution,
  buildSocialAccountsTargetResolution,
  buildSocialPostsTargetResolution,
  checkTaskScheduleIdNotBotSchedule,
  resolveBotScheduleTargetForWrite,
  resolveNewsletterTargetForWrite,
  resolveProjectTargetForWrite,
  resolveSocialPostTargetForWrite,
  resolveTargetCandidate,
} from "./target-resolver";

const P1 = "01960001-0001-7001-8001-000000000001";
const P2 = "01960001-0001-7001-8001-000000000002";
const P3 = "01960001-0001-7001-8001-000000000003";
const C1 = "01960001-0001-7001-8001-0000000000a1";
const C2 = "01960001-0001-7001-8001-0000000000a2";
const POST1 = "01960001-0001-7001-8001-0000000000b1";
const SCHED1 = "01960001-0001-7001-8001-0000000000d1";
const SCHED2 = "01960001-0001-7001-8001-0000000000d2";
const TASK_SCHED = "01960001-0001-7001-8001-0000000000e1";

function auth(
  overrides: {
    source?: string;
    chainDepth?: number;
    askedByKind?: string;
    botProjectId?: string | null;
    versionId?: string;
  } = {},
): AuthorizedSokoBotRuntime {
  return {
    turn: {
      id: "turn-1",
      sokoBotId: "bot-1",
      workspaceId: "ws-1",
      actingUserId: "user-1",
      requestedByUserId: "user-1",
      versionId: overrides.versionId ?? "v36",
      source: overrides.source ?? "CHAT",
      chainDepth: overrides.chainDepth ?? 0,
      botProjectId: overrides.botProjectId ?? null,
    },
    askedByKind: overrides.askedByKind ?? "OWNER",
    reader: overrides.botProjectId
      ? { sharedScope: { projectId: overrides.botProjectId } }
      : { sharedScope: null },
  } as unknown as AuthorizedSokoBotRuntime;
}

function ownerSays(userMessage: string) {
  db.turnFindUnique.mockResolvedValue({
    id: "turn-1",
    createdAt: new Date("2026-11-27T10:00:00Z"),
    userMessage,
    destinationRoomId: null,
    parentTurnId: null,
    source: "CHAT",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.targetResolverEnabled = true;
});

describe("destination-bound target matching (ask-policy-match)", () => {
  const projects = [
    { id: P1, name: "Acme Marketing" },
    { id: P2, name: "Beta" },
    { id: P3, name: "Delta AG Outreach" },
  ];
  const socialCandidates = [
    {
      id: C1,
      externalHandle: "acme",
      project: { id: P1, name: "Acme Marketing" },
    },
    { id: C2, externalHandle: "pat", project: { id: P2, name: "Beta" } },
  ];

  it("resolves unambiguous destination phrases while rejecting topic mentions, quoted copy, stopwords, and ties", () => {
    expect(
      namedProjectsByTargetResolver(
        "Turn the launch doc into 3 X posts for Acme spread over next week.",
        projects,
      ).map((p) => p.id),
    ).toEqual([P1]);

    expect(
      namedProjectsByTargetResolver(
        "Draft a LinkedIn update for Delta AG from the research.",
        projects,
      ).map((p) => p.id),
    ).toEqual([P3]);

    expect(
      namedSocialDestinationsByTargetResolver(
        "Turn the launch doc into 3 X posts for Acme spread over next week.",
        socialCandidates,
      ).map((c) => c.id),
    ).toEqual([C1]);

    expect(
      namedSocialDestinationsByTargetResolver(
        "Publish this on Acme's X account tomorrow.",
        socialCandidates,
      ).map((c) => c.id),
    ).toEqual([C1]);

    // Quoted copy, topic mentions, stopwords, and short names must not resolve.
    for (const ambiguous of [
      'Post this on X: "Big launch for Acme!"',
      "Write an X post about Acme's new release.",
      "Write an X post on Acme's new release.",
      "Search for Acme competitors and post an update.",
      "Write about pat.",
      "Draft an X post for Marketing.",
    ]) {
      expect(
        namedSocialDestinationsByTargetResolver(ambiguous, socialCandidates),
      ).toEqual([]);
    }

    // Ambiguous ties across two candidates return [] instead of guessing.
    const tied = [
      {
        id: C1,
        externalHandle: "acme_us",
        project: { id: P1, name: "Acme US" },
      },
      {
        id: C2,
        externalHandle: "acme_eu",
        project: { id: P2, name: "Acme EU" },
      },
    ];
    expect(
      namedSocialDestinationsByTargetResolver(
        "Draft an X post for Acme.",
        tied,
      ),
    ).toEqual([]);
    expect(
      namedProjectsByTargetResolver("Create a task for Acme.", [
        { id: P1, name: "Acme US" },
        { id: P2, name: "Acme EU" },
      ]),
    ).toEqual([]);

    // Source project mentions must never win over a destination phrase or attach a target.
    expect(
      namedProjectsByTargetResolver(
        "Use the notes from Beta to create a task for Acme.",
        projects,
      ).map((p) => p.id),
    ).toEqual([P1]);
    expect(
      namedProjectsByTargetResolver(
        "Use Beta's notes to create a task for Acme.",
        projects,
      ).map((p) => p.id),
    ).toEqual([P1]);
    expect(
      namedProjectsByTargetResolver(
        "Use the notes in Beta to create a task for Acme.",
        projects,
      ).map((p) => p.id),
    ).toEqual([P1]);
    expect(
      namedProjectsByTargetResolver(
        "Use the notes from Beta to create a task.",
        projects,
      ),
    ).toEqual([]);
    expect(
      namedSocialDestinationsByTargetResolver(
        "Use the notes from Beta to draft an X post for Acme.",
        socialCandidates,
      ).map((c) => c.id),
    ).toEqual([C1]);
    expect(
      namedSocialDestinationsByTargetResolver(
        "Draft an X post from Beta's notes.",
        socialCandidates,
      ),
    ).toEqual([]);
    // Exact full-name destination still wins when another project shares its leading token.
    expect(
      namedProjectsByTargetResolver("Create a task for Acme.", [
        { id: P1, name: "Acme" },
        { id: P2, name: "Acme Marketing" },
      ]).map((p) => p.id),
    ).toEqual([P1]);
  });

  it("refuses project-name social resolution when that project holds 2 accounts", () => {
    const sameProjectTwoAccounts = [
      {
        id: C1,
        externalHandle: "acme_main",
        project: { id: P1, name: "Acme Marketing" },
      },
      {
        id: C2,
        externalHandle: "acme_dev",
        project: { id: P1, name: "Acme Marketing" },
      },
    ];
    expect(
      namedSocialDestinationsByTargetResolver(
        "Draft an X post for Acme.",
        sameProjectTwoAccounts,
      ),
    ).toEqual([]);
  });
});

describe("resolveTargetCandidate (pure 0 / 1 / 2+ rule)", () => {
  it("handles missing, single candidate, uniquely named, and ambiguous outcomes", () => {
    const base = {
      emptyReason: "none",
      ambiguousReason: (cs: readonly string[]) => `pick: ${cs.join(",")}`,
      singleCandidateReason: (c: string) => `only: ${c}`,
      namedCandidateReason: (c: string) => `named: ${c}`,
    };
    expect(
      resolveTargetCandidate({ ...base, candidates: [], named: [] }),
    ).toEqual({
      status: "missing",
      reason: "none",
    });
    expect(
      resolveTargetCandidate({ ...base, candidates: ["a"], named: [] }),
    ).toEqual({
      status: "resolved",
      target: "a",
      autoResolved: true,
      reason: "only: a",
    });
    expect(
      resolveTargetCandidate({ ...base, candidates: ["a", "b"], named: ["b"] }),
    ).toEqual({
      status: "resolved",
      target: "b",
      autoResolved: true,
      reason: "named: b",
    });
    expect(
      resolveTargetCandidate({ ...base, candidates: ["a", "b"], named: [] }),
    ).toEqual({
      status: "ambiguous",
      candidates: ["a", "b"],
      reason: "pick: a,b",
    });
  });
});

describe("resolveProjectTargetForWrite", () => {
  it("is a no-op when targetResolver flag is off", async () => {
    state.targetResolverEnabled = false;
    await expect(
      resolveProjectTargetForWrite(auth(), {
        projectId: undefined,
        mode: "optional",
        capability: "create_task",
      }),
    ).resolves.toEqual({ projectId: undefined });
    expect(db.projectFindMany).not.toHaveBeenCalled();
  });

  it("auto-resolves omitted optional projectId when 1 project is named, leaves project-free tasks untouched, and blocks mismatches", async () => {
    db.projectFindMany.mockResolvedValue([
      { id: P1, name: "Acme Marketing" },
      { id: P2, name: "Beta" },
    ]);

    ownerSays("Create a task for Acme to review the landing page.");
    const auto = await resolveProjectTargetForWrite(auth(), {
      projectId: undefined,
      mode: "optional",
      capability: "create_task",
    });
    expect(auto.projectId).toBe(P1);
    expect(auto.resolvedTarget).toMatchObject({
      kind: "project",
      id: P1,
      autoResolved: true,
    });

    // Wrong explicit projectId when owner named Acme -> refused.
    await expect(
      resolveProjectTargetForWrite(auth(), {
        projectId: P2,
        mode: "optional",
        capability: "create_task",
      }),
    ).rejects.toThrow(/owner named Project "Acme Marketing"/);

    // No project named -> leave project-free task alone.
    ownerSays("Create a task to renew the domain.");
    await expect(
      resolveProjectTargetForWrite(auth(), {
        projectId: undefined,
        mode: "optional",
        capability: "create_task",
      }),
    ).resolves.toEqual({ projectId: undefined });

    // Multi-project request naming both Alpha and Beta -> allows either without false veto.
    ownerSays("Create one task for Acme Marketing and one for Beta.");
    await expect(
      resolveProjectTargetForWrite(auth(), {
        projectId: P2,
        mode: "optional",
        capability: "create_task",
      }),
    ).resolves.toEqual({ projectId: P2 });
  });

  it("does not file a task in the source project named in the owner's request", async () => {
    db.projectFindMany.mockResolvedValue([
      { id: P1, name: "Acme Marketing" },
      { id: P2, name: "Beta" },
    ]);
    ownerSays("Use the notes from Beta to create a task for Acme.");
    const result = await resolveProjectTargetForWrite(auth(), {
      mode: "optional",
      capability: "create_task",
    });
    expect(result.projectId).toBe(P1);
    expect(result.projectId).not.toBe(P2);

    // Source-only mention with no destination project leaves projectId unset.
    ownerSays("Use the notes from Beta to create a task.");
    const sourceOnly = await resolveProjectTargetForWrite(auth(), {
      mode: "optional",
      capability: "create_task",
    });
    expect(sourceOnly.projectId).toBeUndefined();
  });

  it("checks studio media project against the sole project holding an active requested social account", async () => {
    db.projectFindMany.mockResolvedValue([
      { id: P1, name: "Acme Marketing" },
      { id: P2, name: "Beta" },
    ]);
    db.connectionFindMany.mockResolvedValue([
      { project: { id: P1, name: "Acme Marketing" } },
    ]);
    ownerSays("Make me 2 square images for an X post announcing our meetup.");

    const right = await resolveProjectTargetForWrite(auth(), {
      projectId: P1,
      mode: "studio_media",
      capability: "generate_image",
    });
    expect(right.resolvedTarget).toMatchObject({
      kind: "project",
      id: P1,
      reason: expect.stringContaining(
        "Only open project with an active X account",
      ),
    });

    await expect(
      resolveProjectTargetForWrite(auth(), {
        projectId: P2,
        mode: "studio_media",
        capability: "generate_image",
      }),
    ).rejects.toThrow(/only open project with an active X account/);
  });

  it("keeps single-project shared bots confined without querying other projects", async () => {
    const shared = auth({ botProjectId: P1 });
    await expect(
      resolveProjectTargetForWrite(shared, {
        projectId: P2,
        mode: "required",
        capability: "generate_image",
      }),
    ).rejects.toThrow(/one project only/);
    const auto = await resolveProjectTargetForWrite(shared, {
      projectId: undefined,
      mode: "optional",
      capability: "create_task",
    });
    expect(auto.projectId).toBe(P1);
    expect(db.projectFindMany).not.toHaveBeenCalled();
  });
});

describe("resolveNewsletterTargetForWrite", () => {
  it("resolves 1 newsletter, refuses 0 without substituting a named project, and refuses 2+ when none is named", async () => {
    db.projectFindMany.mockResolvedValue([
      { id: P1, name: "Acme Marketing" },
      { id: P2, name: "Beta" },
    ]);
    db.newsletterFindMany.mockResolvedValue([
      {
        id: "nl-1",
        name: "Acme Weekly",
        projectId: P1,
        project: { id: P1, name: "Acme Marketing" },
      },
    ]);

    ownerSays("Draft a newsletter issue from our site.");
    await expect(
      resolveNewsletterTargetForWrite(auth(), {
        projectId: P1,
        capability: "newsletter_draft_issue",
      }),
    ).resolves.toMatchObject({
      resolvedTarget: { kind: "newsletter", id: "nl-1", projectId: P1 },
    });

    // Named project Beta has 0 newsletters -> refuse without substituting Acme.
    ownerSays("Draft a newsletter issue for Beta.");
    await expect(
      resolveNewsletterTargetForWrite(auth(), {
        projectId: P2,
        capability: "newsletter_draft_issue",
      }),
    ).rejects.toThrow(/No newsletter is set up on the requested project/);

    // 2 newsletters, none named -> ambiguous refusal.
    db.newsletterFindMany.mockResolvedValue([
      {
        id: "nl-1",
        name: "Acme Weekly",
        projectId: P1,
        project: { id: P1, name: "Acme Marketing" },
      },
      {
        id: "nl-2",
        name: "Beta Digest",
        projectId: P2,
        project: { id: P2, name: "Beta" },
      },
    ]);
    ownerSays("Draft a newsletter issue about our Q4 release.");
    await expect(
      resolveNewsletterTargetForWrite(auth(), {
        projectId: P1,
        capability: "newsletter_draft_issue",
      }),
    ).rejects.toThrow(/Several projects have newsletters set up/);
  });
});

describe("resolveSocialPostTargetForWrite", () => {
  it("returns existing post details, redirects cross-project postIds on personal bots, and never leaks across projects on shared bots", async () => {
    db.projectFindMany.mockResolvedValue([
      { id: P1, name: "Acme Marketing" },
      { id: P2, name: "Beta" },
    ]);
    ownerSays("Shorten the draft post.");

    db.socialPostFindFirst.mockResolvedValueOnce({
      id: POST1,
      status: "NEEDS_APPROVAL",
      revision: 2,
      socialConnectionId: C1,
    });
    await expect(
      resolveSocialPostTargetForWrite(auth(), {
        projectId: P1,
        postId: POST1,
        capability: "update_social_post",
      }),
    ).resolves.toMatchObject({
      existingSocialConnectionId: C1,
      resolvedTarget: { kind: "post", id: POST1 },
    });

    // Missing on P1, exists on P2 -> redirect personal bot to P2.
    db.socialPostFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: POST1,
      projectId: P2,
      project: { name: "Beta" },
    });
    await expect(
      resolveSocialPostTargetForWrite(auth(), {
        projectId: P1,
        postId: POST1,
        capability: "update_social_post",
      }),
    ).rejects.toThrow(/belongs to Project "Beta"/);

    // Shared bot: missing on own project lists editable posts without cross-project lookup.
    db.socialPostFindFirst.mockReset();
    db.socialPostFindFirst.mockResolvedValueOnce(null);
    db.socialPostFindMany.mockResolvedValueOnce([
      { id: POST1, status: "DRAFT", revision: 1 },
    ]);
    await expect(
      resolveSocialPostTargetForWrite(auth({ botProjectId: P1 }), {
        projectId: P1,
        postId: "01960001-0001-7001-8001-0000000000ff",
        capability: "update_social_post",
      }),
    ).rejects.toThrow(/The only editable post here is postId/);
    expect(db.socialPostFindFirst).toHaveBeenCalledTimes(1);
  });
});

describe("schedule target resolver", () => {
  it("detects cross-kind schedule UUID mixups in both directions", async () => {
    db.sokoBotScheduleFindMany.mockResolvedValue([]);
    db.taskScheduleFindFirst.mockResolvedValue({
      id: TASK_SCHED,
      name: "Daily researcher",
    });

    await expect(
      resolveBotScheduleTargetForWrite(auth(), {
        scheduleId: TASK_SCHED,
        capability: "update_schedule",
      }),
    ).rejects.toThrow(/Task Schedule.*Use save_task_schedule/);

    db.sokoBotScheduleFindFirst.mockResolvedValue({
      id: SCHED1,
      name: "Monday summary",
    });
    await expect(
      checkTaskScheduleIdNotBotSchedule(auth(), SCHED1, "delete_task_schedule"),
    ).rejects.toThrow(/bot follow-up schedule.*Use delete_schedule/);
  });

  it("uniquely matches custom scheduleName while skipping built-in rhythms and refusing ties", async () => {
    db.sokoBotScheduleFindMany.mockResolvedValue([
      { id: "builtin-1", name: "Monday plan", systemKey: "monday_plan" },
      { id: SCHED1, name: "Monday coworker report", systemKey: null },
    ]);

    const resolved = await resolveBotScheduleTargetForWrite(auth(), {
      scheduleName: "Monday",
      capability: "update_schedule",
      changesPromptOrName: true,
    });
    expect(resolved.scheduleId).toBe(SCHED1);
    expect(resolved.resolvedTarget).toMatchObject({
      kind: "schedule",
      id: SCHED1,
      autoResolved: true,
    });

    // Two custom schedules match -> refuse listing both IDs.
    db.sokoBotScheduleFindMany.mockResolvedValue([
      { id: SCHED1, name: "Monday coworker report", systemKey: null },
      { id: SCHED2, name: "Monday sales report", systemKey: null },
    ]);
    await expect(
      resolveBotScheduleTargetForWrite(auth(), {
        scheduleName: "Monday report",
        capability: "update_schedule",
        changesPromptOrName: true,
      }),
    ).rejects.toThrow(new RegExp(`${SCHED1}.*${SCHED2}`));

    // Zero custom schedules (only built-ins) -> tell bot to call create_schedule
    // when attempting to edit prompt/name on a built-in or non-existent custom schedule.
    db.sokoBotScheduleFindMany.mockResolvedValue([
      { id: "builtin-1", name: "Monday plan", systemKey: "monday_plan" },
    ]);
    await expect(
      resolveBotScheduleTargetForWrite(auth(), {
        scheduleName: "Monday plan",
        capability: "update_schedule",
        changesPromptOrName: true,
      }),
    ).rejects.toThrow(/built-in rhythm.*create_schedule/);
    await expect(
      resolveBotScheduleTargetForWrite(auth(), {
        scheduleName: "Monday report",
        capability: "update_schedule",
        changesPromptOrName: true,
      }),
    ).rejects.toThrow(/0 custom schedules exist.*create_schedule/);
    // Timing/on-off edits on a built-in rhythm remain allowed.
    await expect(
      resolveBotScheduleTargetForWrite(auth(), {
        scheduleName: "Monday plan",
        capability: "update_schedule",
        changesPromptOrName: false,
      }),
    ).resolves.toMatchObject({ scheduleId: "builtin-1" });
  });

  it("does not alter scheduled-run (source=SCHEDULE) behavior", async () => {
    await expect(
      resolveBotScheduleTargetForWrite(auth({ source: "SCHEDULE" }), {
        scheduleName: "Monday",
        capability: "update_schedule",
      }),
    ).resolves.toEqual({ scheduleId: undefined });
    expect(db.sokoBotScheduleFindMany).not.toHaveBeenCalled();
  });
});

describe("list-tool targetResolution annotations", () => {
  it("annotates list_project_social_accounts across workspace on personal bots and stays project-scoped on shared bots", async () => {
    db.connectionFindMany.mockResolvedValue([
      {
        id: C1,
        provider: "x",
        externalHandle: "acme",
        project: { id: P1, name: "Acme Marketing" },
      },
      {
        id: C2,
        provider: "x",
        externalHandle: "pat",
        project: { id: P2, name: "Beta" },
      },
      {
        id: "li-1",
        provider: "linkedin",
        externalHandle: "acme-co",
        project: { id: P1, name: "Acme Marketing" },
      },
    ]);
    const personalSummary = await buildSocialAccountsTargetResolution(
      auth(),
      P1,
      [{ id: C1, provider: "x", status: "active", externalHandle: "acme" }],
    );
    expect(personalSummary.x).toMatchObject({ status: "ambiguous", count: 2 });
    expect(personalSummary.linkedin).toMatchObject({
      status: "only_candidate",
      count: 1,
      onlyCandidate: { socialConnectionId: "li-1", projectId: P1 },
    });

    // Shared bot must never query workspace-wide connections.
    db.connectionFindMany.mockReset();
    db.projectFindUnique.mockResolvedValue({ id: P1, name: "Acme Marketing" });
    const sharedSummary = await buildSocialAccountsTargetResolution(
      auth({ botProjectId: P1 }),
      P1,
      [{ id: C1, provider: "x", status: "active", externalHandle: "acme" }],
    );
    expect(db.connectionFindMany).not.toHaveBeenCalled();
    expect(sharedSummary.x).toMatchObject({
      status: "only_candidate",
      count: 1,
    });
  });

  it("annotates list_social_posts and list_schedules for 0, 1, and 2+ editable candidates", () => {
    expect(buildSocialPostsTargetResolution(P1, [])).toMatchObject({
      status: "missing",
      editableCount: 0,
    });
    expect(
      buildSocialPostsTargetResolution(P1, [
        { id: POST1, status: "NEEDS_APPROVAL", revision: 3 },
        { id: "pub-1", status: "PUBLISHED", revision: 4 },
      ]),
    ).toMatchObject({
      status: "only_candidate",
      editableCount: 1,
      onlyCandidate: { postId: POST1, revision: 3 },
    });
    expect(
      buildSocialPostsTargetResolution(
        P1,
        [{ id: POST1, status: "DRAFT", revision: 1 }],
        { hasMore: true },
      ),
    ).toMatchObject({
      status: "partial",
      editableCount: 1,
    });
    expect(
      buildSocialPostsTargetResolution(
        P1,
        [{ id: POST1, status: "DRAFT", revision: 1 }],
        { hasCursor: true },
      ),
    ).toMatchObject({
      status: "partial",
      editableCount: 1,
    });
    expect(
      buildSocialPostsTargetResolution(P1, [], { hasMore: true }),
    ).toMatchObject({
      status: "partial",
      editableCount: 0,
    });

    expect(
      buildSchedulesTargetResolution({
        botSchedules: [
          {
            id: SCHED1,
            name: "Weekly coworker report",
            createdBy: "Robin",
            youCanChange: true,
          },
        ],
        hasMore: true,
      }),
    ).toMatchObject({
      status: "partial",
      editableCustomBotCount: 1,
    });

    expect(
      buildSchedulesTargetResolution({
        botSchedules: [
          {
            id: "b1",
            name: "Monday plan",
            createdBy: "built-in rhythm",
            youCanChange: true,
          },
        ],
      }),
    ).toMatchObject({
      status: "missing_custom",
      builtInRhythmCount: 1,
      editableCustomBotCount: 0,
    });

    expect(
      buildSchedulesTargetResolution({
        botSchedules: [
          {
            id: "b1",
            name: "Monday plan",
            createdBy: "built-in rhythm",
            youCanChange: true,
          },
          {
            id: SCHED1,
            name: "Weekly coworker report",
            createdBy: "Robin",
            youCanChange: true,
          },
        ],
      }),
    ).toMatchObject({
      status: "only_candidate",
      onlyCandidate: { kind: "bot_schedule", scheduleId: SCHED1 },
    });
  });
});
