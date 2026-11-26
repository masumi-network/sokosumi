import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  connectionFindFirst: vi.fn(),
  connectionFindMany: vi.fn(),
  turnFindUnique: vi.fn(),
  turnFindMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSocialConnection: {
      findFirst: db.connectionFindFirst,
      findMany: db.connectionFindMany,
    },
    sokoBotTurn: {
      findUniqueOrThrow: db.turnFindUnique,
      findMany: db.turnFindMany,
    },
  },
}));

import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";
import {
  ASK_WHICH_ACCOUNT,
  requireChosenSocialDestination,
} from "./social-destination";

const COMPANY = "01960001-0001-7001-8001-0000000000a1";
const PERSONAL = "01960001-0001-7001-8001-0000000000a2";
const NOW = new Date("2026-11-26T10:00:00Z");
const candidates = [
  {
    id: COMPANY,
    externalHandle: "acme_hq",
    project: { id: "p1", name: "Company marketing" },
  },
  {
    id: PERSONAL,
    externalHandle: "pat",
    project: { id: "p2", name: "Founder notes" },
  },
];
const onCompany = { projectId: "p1", socialConnectionId: COMPANY };
const onPersonal = { projectId: "p2", socialConnectionId: PERSONAL };

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
    userMessage: message,
    createdAt: NOW,
    destinationRoomId: null,
  });
}

/** Earlier turns in this chat, newest first. */
function earlierTurns(
  ...turns: { answer?: string; refusal?: string; posted?: boolean }[]
) {
  db.turnFindMany.mockResolvedValue(
    turns.map((earlier) => ({
      status: "COMPLETED",
      finalAnswer: earlier.answer ?? "",
      toolCalls: [
        ...(earlier.posted ? [{ status: "COMPLETED", errorDetail: null }] : []),
        ...(earlier.refusal
          ? [{ status: "FAILED", errorDetail: earlier.refusal }]
          : []),
      ],
    })),
  );
}

const check = (params: typeof onCompany | { projectId: string }) =>
  requireChosenSocialDestination(turn(), params);

/** What Core said the first time, as recorded on the failed tool call. */
async function firstRefusal(): Promise<string> {
  ownerSays("Write an X post about our launch.");
  return check(onCompany).then(
    () => "",
    (error: Error) => error.message,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  db.connectionFindFirst.mockResolvedValue({ provider: "x" });
  db.connectionFindMany.mockResolvedValue(candidates);
  db.turnFindMany.mockResolvedValue([]);
});

describe("requireChosenSocialDestination", () => {
  it("refuses a first draft when two accounts fit, listing them in order", async () => {
    const refusal = await firstRefusal();
    expect(refusal).toMatch(new RegExp(`^${ASK_WHICH_ACCOUNT}`));
    expect(refusal).toMatch(/@acme_hq .*@pat /);
  });

  it("goes ahead on the account the owner named by @handle or id, and only there", async () => {
    ownerSays("Post this on @pat: shipping today.");
    await expect(check(onPersonal)).resolves.toBeUndefined();
    await expect(check(onCompany)).rejects.toThrow(/owner named @pat /);
    ownerSays(`Use ${COMPANY}.`);
    await expect(check(onCompany)).resolves.toBeUndefined();
    ownerSays("Post it on @acme_hq and on @pat.");
    await expect(check(onCompany)).resolves.toBeUndefined();
    await expect(check(onPersonal)).resolves.toBeUndefined();
  });

  it("reads no account from ordinary words, names or quoted copy", async () => {
    for (const message of [
      "Draft an X post about our latest patch.",
      "Write about pat and Founder notes.",
      'Post this: "Big thanks to @pat for the help!"',
      "Post this: 'Big thanks to @pat for the help!'",
      "Post this:\n```\nShipped with @pat today\n```",
      "Post this:\n> Shipped with @pat today",
    ]) {
      ownerSays(message);
      await expect(check(onPersonal)).rejects.toThrow(ASK_WHICH_ACCOUNT);
    }
  });

  it("after Core's question, lets through the option the bot picked from it", async () => {
    const refusal = await firstRefusal();
    earlierTurns({ answer: "Which one?", refusal });
    // What the answer means is the model's call; Core reads no words.
    for (const message of ["the second one", "my personal one"]) {
      ownerSays(message);
      await expect(check(onPersonal)).resolves.toBeUndefined();
    }
  });

  it("counts a question the bot asked on its own when it listed the accounts", async () => {
    earlierTurns({ answer: "Which account: @acme_hq or @pat?" });
    ownerSays("the first");
    await expect(check(onCompany)).resolves.toBeUndefined();
    // A reply naming one account is no question.
    earlierTurns({ answer: "Drafting on @pat now." });
    await expect(check(onPersonal)).rejects.toThrow(ASK_WHICH_ACCOUNT);
  });

  it("only options that were shown can be picked", async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `01960001-0001-7001-8001-0000000003${String(index).padStart(2, "0")}`,
      externalHandle: `brand_${index}`,
      project: { id: `p${index}`, name: `Brand ${index}` },
    }));
    db.connectionFindMany.mockResolvedValue(many);
    ownerSays("Write an X post.");
    const refusal = await check({
      projectId: "p0",
      socialConnectionId: many[0]?.id ?? "",
    }).then(
      () => "",
      (error: Error) => error.message,
    );
    expect(refusal).toMatch(/and 2 more/);
    earlierTurns({ refusal });
    ownerSays("the last one");
    await expect(
      check({ projectId: "p9", socialConnectionId: many[9]?.id ?? "" }),
    ).resolves.toBeUndefined();
    await expect(
      check({ projectId: "p11", socialConnectionId: many[11]?.id ?? "" }),
    ).rejects.toThrow(/option the owner picked/);
    // Named exactly, an account beyond the ten still goes.
    ownerSays("Post it on @brand_11.");
    await expect(
      check({ projectId: "p11", socialConnectionId: many[11]?.id ?? "" }),
    ).resolves.toBeUndefined();
  });

  it("keeps the question open over a few turns until a post is saved", async () => {
    const refusal = await firstRefusal();
    ownerSays("the second one");
    earlierTurns({ answer: "Sure, take your time." }, { refusal });
    await expect(check(onPersonal)).resolves.toBeUndefined();
    earlierTurns({ answer: "Drafted.", posted: true }, { refusal });
    await expect(check(onPersonal)).rejects.toThrow(ASK_WHICH_ACCOUNT);
  });

  it("looks for the question in this chat and the last day", async () => {
    await firstRefusal();
    const [{ where }] = db.turnFindMany.mock.calls[0];
    expect(where.destinationRoomId).toBeNull();
    expect(where.createdAt.lt).toEqual(NOW);
    expect(where.createdAt.gte).toEqual(new Date(NOW.getTime() - 86_400_000));
    const [{ where: connections }] = db.connectionFindMany.mock.calls[0];
    expect(connections.project).toMatchObject({
      closedAt: null,
      closingAt: null,
    });
    expect(db.connectionFindMany.mock.calls[0]?.[0].take).toBeUndefined();
  });

  it("asks nothing with one fitting account, on a turn the owner did not type, or for Cuso", async () => {
    ownerSays("Write an X post.");
    db.connectionFindMany.mockResolvedValueOnce([candidates[0]]);
    await expect(check(onCompany)).resolves.toBeUndefined();
    for (const other of [
      turn({ source: "SCHEDULE" }),
      turn({ versionId: "cmo-v23" }),
    ])
      await expect(
        requireChosenSocialDestination(other, onCompany),
      ).resolves.toBeUndefined();
  });
});
