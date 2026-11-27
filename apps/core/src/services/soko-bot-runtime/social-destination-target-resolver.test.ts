import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  targetResolverEnabled: false,
}));

const db = vi.hoisted(() => ({
  connectionFindFirst: vi.fn(),
  connectionFindMany: vi.fn(),
  projectFindMany: vi.fn(),
  turnFindUnique: vi.fn(),
  questionCreate: vi.fn(),
  questionFindFirst: vi.fn(),
  questionFindUnique: vi.fn(),
  questionFindUniqueOrThrow: vi.fn(),
  questionUpdateMany: vi.fn(),
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
    projectSocialConnection: {
      findFirst: db.connectionFindFirst,
      findMany: db.connectionFindMany,
    },
    project: { findMany: db.projectFindMany },
    sokoBotTurn: { findUnique: db.turnFindUnique },
    sokoBotAccountQuestion: {
      create: db.questionCreate,
      findFirst: db.questionFindFirst,
      findUnique: db.questionFindUnique,
      findUniqueOrThrow: db.questionFindUniqueOrThrow,
      updateMany: db.questionUpdateMany,
    },
  },
}));

import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";
import {
  ASK_WHICH_ACCOUNT,
  requireChosenSocialDestination,
} from "./social-destination";

const ACME_CONN = "01960001-0001-7001-8001-0000000000a1";
const PAT_CONN = "01960001-0001-7001-8001-0000000000a2";
const QUESTION = "01960001-0001-7001-8001-0000000000f1";
const P1 = "01960001-0001-7001-8001-000000000001";
const P2 = "01960001-0001-7001-8001-000000000002";
const P3 = "01960001-0001-7001-8001-000000000003";
const NOW = new Date("2026-11-27T10:00:00Z");

const candidates = [
  {
    id: ACME_CONN,
    provider: "x",
    externalHandle: "acme",
    project: { id: P1, name: "Acme Marketing" },
  },
  {
    id: PAT_CONN,
    provider: "x",
    externalHandle: "pat_personal",
    project: { id: P2, name: "Pat Personal" },
  },
];

function turn(overrides: Record<string, unknown> = {}) {
  return {
    turn: {
      id: "turn-now",
      sokoBotId: "bot",
      workspaceId: "ws",
      requestedByUserId: "owner",
      versionId: "v37",
      source: "CHAT",
      chainDepth: 0,
      ...overrides,
    },
    askedByKind: "OWNER",
  } as unknown as AuthorizedSokoBotRuntime;
}

function ownerSays(message: string) {
  db.turnFindUnique.mockResolvedValue({
    id: "turn-now",
    userMessage: message,
    createdAt: NOW,
    destinationRoomId: null,
    parentTurnId: null,
    source: "CHAT",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.targetResolverEnabled = true;
  db.connectionFindFirst.mockResolvedValue({
    id: ACME_CONN,
    provider: "x",
    externalHandle: "acme",
  });
  db.connectionFindMany.mockResolvedValue(candidates);
  db.projectFindMany.mockResolvedValue([
    { id: P1, name: "Acme Marketing" },
    { id: P2, name: "Pat Personal" },
    { id: P3, name: "Beta" },
  ]);
  db.questionCreate.mockResolvedValue({
    id: QUESTION,
    optionIds: [ACME_CONN, PAT_CONN],
  });
  db.questionFindFirst.mockResolvedValue(null);
  db.questionFindUnique.mockResolvedValue(null);
  db.questionUpdateMany.mockResolvedValue({ count: 1 });
});

describe("requireChosenSocialDestination under targetResolver (E10)", () => {
  it("paired control: resolves natural destination naming only when targetResolver is enabled", async () => {
    ownerSays(
      "Turn this one-pager into 3 X posts for Acme spread over next week.",
    );

    state.targetResolverEnabled = false;
    await expect(
      requireChosenSocialDestination(turn(), {
        projectId: P1,
        socialConnectionId: ACME_CONN,
      }),
    ).rejects.toThrow(ASK_WHICH_ACCOUNT);

    state.targetResolverEnabled = true;
    await expect(
      requireChosenSocialDestination(turn(), {
        projectId: P1,
        socialConnectionId: ACME_CONN,
      }),
    ).resolves.toMatchObject({
      resolvedTarget: { kind: "account", id: ACME_CONN, projectId: P1 },
    });
  });

  it("still refuses and records SokoBotAccountQuestion on quoted copy or topic mentions", async () => {
    for (const msg of [
      'Post this on X: "We just shipped a big update for Acme!"',
      "Write an X post about Acme's new release.",
    ]) {
      ownerSays(msg);
      await expect(
        requireChosenSocialDestination(turn(), {
          projectId: P1,
          socialConnectionId: ACME_CONN,
        }),
      ).rejects.toThrow(ASK_WHICH_ACCOUNT);
    }
  });

  it("auto-resolves omitted socialConnectionId when 1 active account fits on personal and CMO bots", async () => {
    ownerSays("Draft an X post about our launch.");
    db.connectionFindFirst.mockResolvedValue(null);
    db.connectionFindMany.mockResolvedValue([candidates[0]]);

    const personal = await requireChosenSocialDestination(turn(), {
      projectId: P1,
    });
    expect(personal.resolvedSocialConnectionId).toBe(ACME_CONN);
    expect(personal.resolvedTarget).toMatchObject({
      kind: "account",
      id: ACME_CONN,
      autoResolved: true,
    });

    const cmo = await requireChosenSocialDestination(
      turn({ versionId: "cmo-v23" }),
      { projectId: P1 },
    );
    expect(cmo.resolvedSocialConnectionId).toBe(ACME_CONN);

    // CMO bot with 0 active connections preserves unconnected drafting.
    db.connectionFindMany.mockResolvedValue([]);
    await expect(
      requireChosenSocialDestination(turn({ versionId: "cmo-v23" }), {
        projectId: P1,
      }),
    ).resolves.toEqual({});
  });

  it("refuses named project lacking an account without substituting another project, while respecting explicit @handle", async () => {
    ownerSays("Draft an X post for Beta.");
    db.connectionFindFirst.mockResolvedValue(null);
    db.connectionFindMany.mockResolvedValue([candidates[0]]);

    await expect(
      requireChosenSocialDestination(turn(), { projectId: P3 }),
    ).rejects.toThrow(/Project "Beta" has 0 active X accounts/);
    await expect(
      requireChosenSocialDestination(turn(), {
        projectId: P1,
        socialConnectionId: ACME_CONN,
      }),
    ).rejects.toThrow(/owner named Project "Beta"/);

    // Explicit @handle overrides a topic mention of another project's name.
    ownerSays("Draft an X post on @acme about Beta.");
    db.connectionFindFirst.mockResolvedValue({
      id: ACME_CONN,
      provider: "x",
      externalHandle: "acme",
    });
    db.connectionFindMany.mockResolvedValue(candidates);
    await expect(
      requireChosenSocialDestination(turn(), {
        projectId: P1,
        socialConnectionId: ACME_CONN,
      }),
    ).resolves.toMatchObject({
      resolvedTarget: { kind: "account", id: ACME_CONN },
    });
  });

  it("refuses personal bot omitted socialConnectionId when 0 accounts exist for the named provider", async () => {
    ownerSays("Draft an X post for our launch.");
    db.connectionFindFirst.mockResolvedValue(null);
    db.connectionFindMany.mockResolvedValue([]);
    await expect(
      requireChosenSocialDestination(turn(), { projectId: P1 }),
    ).rejects.toThrow(/0 active X accounts are connected/);
  });

  it("does not select X when multiple networks exist and the owner named neither", async () => {
    ownerSays("Draft a social update for our new release.");
    db.connectionFindFirst.mockResolvedValue(null);
    db.connectionFindMany
      .mockResolvedValueOnce([{ provider: "x" }, { provider: "linkedin" }])
      .mockResolvedValueOnce([candidates[0]]);
    await expect(
      requireChosenSocialDestination(turn(), { projectId: P1 }),
    ).rejects.toThrow(/across multiple networks/);

    // Full multi-project workspace rows: X on P1 + LinkedIn on P2 -> also refuses.
    db.connectionFindMany.mockReset();
    const liConn = {
      id: "01960001-0001-7001-8001-0000000000a3",
      provider: "linkedin",
      externalHandle: "pat_li",
      project: { id: P2, name: "Pat Personal" },
    };
    db.connectionFindMany.mockResolvedValue([candidates[0], liConn]);
    await expect(
      requireChosenSocialDestination(turn(), { projectId: P1 }),
    ).rejects.toThrow(/across multiple networks/);

    // CMO bot with both X and LinkedIn and omitted socialConnectionId -> refuses.
    await expect(
      requireChosenSocialDestination(turn({ versionId: "cmo-v23" }), {
        projectId: P1,
      }),
    ).rejects.toThrow(ASK_WHICH_ACCOUNT);

    // Positive control: workspace has only 1 active connection (LinkedIn) -> auto-resolves.
    const acmeLi = {
      id: "01960001-0001-7001-8001-0000000000a4",
      provider: "linkedin",
      externalHandle: "acme_li",
      project: { id: P1, name: "Acme Marketing" },
    };
    db.connectionFindMany.mockResolvedValue([acmeLi]);
    await expect(
      requireChosenSocialDestination(turn(), { projectId: P1 }),
    ).resolves.toMatchObject({
      resolvedSocialConnectionId: acmeLi.id,
      resolvedTarget: { kind: "account", id: acmeLi.id, autoResolved: true },
    });
  });

  it.each(["v37", "cmo-v23"])(
    "refuses a conflicting provider for an explicitly requested network (%s)",
    async (versionId) => {
      ownerSays("Draft a LinkedIn post for Acme.");
      db.connectionFindFirst.mockResolvedValue({
        id: ACME_CONN,
        provider: "x",
        externalHandle: "acme",
      });
      db.connectionFindMany.mockResolvedValue([candidates[0]]);
      await expect(
        requireChosenSocialDestination(turn({ versionId }), {
          projectId: P1,
          socialConnectionId: ACME_CONN,
        }),
      ).rejects.toThrow(/owner requested LinkedIn, not X/);

      // When a LinkedIn account exists on the project, refusal points directly to it.
      const acmeLi = {
        id: "01960001-0001-7001-8001-0000000000a4",
        provider: "linkedin",
        externalHandle: "acme_li",
        project: { id: P1, name: "Acme Marketing" },
      };
      db.connectionFindMany.mockResolvedValue([acmeLi]);
      await expect(
        requireChosenSocialDestination(turn({ versionId }), {
          projectId: P1,
          socialConnectionId: ACME_CONN,
        }),
      ).rejects.toThrow(
        new RegExp(`owner requested LinkedIn, not X.*${acmeLi.id}`),
      );

      // Matching LinkedIn connection is accepted.
      db.connectionFindFirst.mockResolvedValue({
        id: acmeLi.id,
        provider: "linkedin",
        externalHandle: "acme_li",
      });
      await expect(
        requireChosenSocialDestination(turn({ versionId }), {
          projectId: P1,
          socialConnectionId: acmeLi.id,
        }),
      ).resolves.toBeDefined();
    },
  );
});
