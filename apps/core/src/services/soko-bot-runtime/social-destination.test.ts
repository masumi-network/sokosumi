import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  connectionFindFirst: vi.fn(),
  connectionFindMany: vi.fn(),
  turnFindUnique: vi.fn(),
  questionCreate: vi.fn(),
  questionFindFirst: vi.fn(),
  questionFindUnique: vi.fn(),
  questionFindUniqueOrThrow: vi.fn(),
  questionUpdateMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSocialConnection: {
      findFirst: db.connectionFindFirst,
      findMany: db.connectionFindMany,
    },
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

import type { Prisma } from "@sokosumi/database";
import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";
import {
  ASK_WHICH_ACCOUNT,
  claimAccountQuestion,
  requireChosenSocialDestination,
} from "./social-destination";

const COMPANY = "01960001-0001-7001-8001-0000000000a1";
const PERSONAL = "01960001-0001-7001-8001-0000000000a2";
const QUESTION = "01960001-0001-7001-8001-0000000000f1";
const NOW = new Date("2026-11-26T10:00:00Z");
const ROOM = "01960001-0001-7001-8001-0000000000c1";
const candidates = [
  {
    id: COMPANY,
    externalHandle: "acme_hq",
    projectId: "p1",
    project: { id: "p1", name: "Company marketing" },
  },
  {
    id: PERSONAL,
    externalHandle: "pat",
    projectId: "p2",
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

function ownerSays(message: string, destinationRoomId: string | null = null) {
  db.turnFindUnique.mockResolvedValue({
    id: "turn-now",
    userMessage: message,
    createdAt: NOW,
    destinationRoomId,
    parentTurnId: null,
    source: "CHAT",
  });
}

const OWNER_TURN_AT = new Date("2026-11-26T09:59:00Z");

/** A background run "turn-now" with its brief, started by the owner's turn. */
function runFrom(ownerMessage: string, brief: string) {
  db.turnFindUnique.mockImplementation(async ({ where }) =>
    where.id === "turn-now"
      ? {
          id: "turn-now",
          userMessage: brief,
          createdAt: NOW,
          destinationRoomId: ROOM,
          parentTurnId: "turn-owner",
          source: "CHAT",
        }
      : {
          id: "turn-owner",
          userMessage: ownerMessage,
          createdAt: OWNER_TURN_AT,
          destinationRoomId: ROOM,
          parentTurnId: null,
          source: "CHAT",
        },
  );
}

const check = (params: Parameters<typeof requireChosenSocialDestination>[1]) =>
  requireChosenSocialDestination(turn(), params);
const answer = (socialConnectionId: string, projectId: string) =>
  check({ projectId, socialConnectionId, accountQuestionId: QUESTION });

beforeEach(() => {
  vi.clearAllMocks();
  db.connectionFindFirst.mockResolvedValue({ provider: "x" });
  db.connectionFindMany.mockResolvedValue(candidates);
  db.questionCreate.mockResolvedValue({
    id: QUESTION,
    optionIds: [COMPANY, PERSONAL],
  });
  db.questionFindFirst.mockResolvedValue(null);
  db.questionFindUnique.mockResolvedValue(null);
  db.questionUpdateMany.mockResolvedValue({ count: 1 });
});

describe("requireChosenSocialDestination", () => {
  it("records a question with its ordered options and refuses the first draft", async () => {
    ownerSays("Write an X post about our launch.", ROOM);
    const refusal = check(onCompany);
    await expect(refusal).rejects.toThrow(ASK_WHICH_ACCOUNT);
    await expect(refusal).rejects.toThrow(
      new RegExp(`Account question ${QUESTION}.*@acme_hq .*@pat `),
    );
    expect(db.questionCreate.mock.calls[0]?.[0].data).toMatchObject({
      sokoBotId: "bot",
      turnId: "turn-now",
      requestedByUserId: "owner",
      destinationRoomId: ROOM,
      provider: "x",
      optionIds: [COMPANY, PERSONAL],
    });
  });

  it("asks once per turn: a second refusal repeats the stored question and its options", async () => {
    ownerSays("Write an X post about our launch.");
    db.questionFindUnique.mockResolvedValueOnce({
      id: QUESTION,
      optionIds: [PERSONAL, COMPANY],
    });
    const refusal = check(onPersonal);
    await expect(refusal).rejects.toThrow(
      new RegExp(`Account question ${QUESTION}.*@pat .*@acme_hq `),
    );
    expect(db.questionCreate).not.toHaveBeenCalled();
    expect(db.questionFindUnique.mock.calls[0]?.[0].where).toEqual({
      turnId_provider: { turnId: "turn-now", provider: "x" },
    });
  });

  it("two refusals at once share one question: the one that loses the unique key reuses the winner", async () => {
    ownerSays("Write an X post about our launch.");
    db.questionCreate.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    const WINNER = "01960001-0001-7001-8001-0000000000f2";
    db.questionFindUniqueOrThrow.mockResolvedValueOnce({
      id: WINNER,
      optionIds: [COMPANY, PERSONAL],
    });
    await expect(check(onCompany)).rejects.toThrow(
      `Account question ${WINNER}`,
    );
  });

  it("skips the question when the request names the account or its only-account Project", async () => {
    for (const message of [
      "Post this on @pat: shipping today.",
      `Use ${PERSONAL}.`,
      "Draft it for Founder notes.",
    ]) {
      ownerSays(message);
      await expect(check(onPersonal)).resolves.toEqual({});
      await expect(check(onCompany)).rejects.toThrow(/owner named @pat /);
    }
    expect(db.questionCreate).not.toHaveBeenCalled();
  });

  it("reads no destination from ordinary words or quoted copy", async () => {
    for (const message of [
      "Draft an X post about our latest patch.",
      "Please hold off until we have all the dates",
      "Write about pat.",
      "Post this: 'Big thanks to @pat for the help!'",
      'Post this: "Big thanks to @pat for the help!"',
      "Post this:\n> Shipped with @pat today",
    ]) {
      ownerSays(message);
      await expect(check(onPersonal)).rejects.toThrow(ASK_WHICH_ACCOUNT);
    }
  });

  it("still asks when the named Project holds two of the accounts", async () => {
    db.connectionFindMany.mockResolvedValue([
      candidates[0],
      { ...candidates[1], project: candidates[0]?.project },
    ]);
    ownerSays("Write an X post for Company marketing.");
    await expect(check(onCompany)).rejects.toThrow(ASK_WHICH_ACCOUNT);
  });

  it("checks an answer against the question open in this chat, and claims nothing yet", async () => {
    ownerSays("Personal", ROOM);
    db.questionFindFirst.mockResolvedValue({
      id: QUESTION,
      optionIds: [COMPANY, PERSONAL],
    });
    await expect(answer(PERSONAL, "p2")).resolves.toEqual({
      answersQuestionId: QUESTION,
      answeringTurnId: "turn-now",
    });
    const [{ where }] = db.questionFindFirst.mock.calls[0];
    expect(where).toMatchObject({
      id: QUESTION,
      sokoBotId: "bot",
      requestedByUserId: "owner",
      destinationRoomId: ROOM,
      turnId: { not: "turn-now" },
      createdAt: { lt: NOW },
    });
    expect(where.turn.status).toBe("COMPLETED");
    // The draft's save claims it, so a failed draft leaves it open.
    expect(db.questionUpdateMany).not.toHaveBeenCalled();
    db.connectionFindMany.mockResolvedValue([candidates[0]]);
    await expect(answer(PERSONAL, "p2")).rejects.toThrow(
      /option the owner picked/,
    );
  });

  it("refuses an answer to a question not open in this chat", async () => {
    ownerSays("Personal");
    db.questionFindFirst.mockResolvedValue(null);
    await expect(answer(PERSONAL, "p2")).rejects.toThrow(/not open/);
  });

  it("a background run never reads its own brief as the owner's choice, and asks nothing itself", async () => {
    runFrom("Write an X post about our launch.", "Draft the post on @pat.");
    await expect(check(onPersonal)).rejects.toThrow(
      /owner has not chosen one.*Draft nothing in this run/,
    );
    expect(db.questionCreate).not.toHaveBeenCalled();
  });

  it("a background run drafts on the account the owner named in the request that started it", async () => {
    runFrom("Write an X post on @pat about our launch.", "Draft the post.");
    await expect(check(onPersonal)).resolves.toEqual({});
    await expect(check(onCompany)).rejects.toThrow(/owner named @pat /);
  });

  it("a background run uses the owner's answer, checked and taken for the owner's turn", async () => {
    runFrom("The second one.", "Draft the launch post.");
    db.questionFindFirst.mockResolvedValue({
      id: QUESTION,
      optionIds: [COMPANY, PERSONAL],
    });
    await expect(answer(PERSONAL, "p2")).resolves.toEqual({
      answersQuestionId: QUESTION,
      answeringTurnId: "turn-owner",
    });
    expect(db.questionFindFirst.mock.calls[0]?.[0].where).toMatchObject({
      turnId: { not: "turn-owner" },
      createdAt: { lt: OWNER_TURN_AT },
      destinationRoomId: ROOM,
    });
  });

  it("asks nothing with one fitting account, on a turn the owner did not type, or for Cuso", async () => {
    ownerSays("Write an X post.");
    db.connectionFindMany.mockResolvedValueOnce([candidates[0]]);
    await expect(check(onCompany)).resolves.toEqual({});
    for (const other of [
      turn({ source: "SCHEDULE" }),
      turn({ versionId: "cmo-v23" }),
    ])
      await expect(
        requireChosenSocialDestination(other, onCompany),
      ).resolves.toEqual({});
    expect(db.questionCreate).not.toHaveBeenCalled();
  });
});

describe("claimAccountQuestion", () => {
  const tx = (count: number) =>
    ({
      sokoBotAccountQuestion: {
        updateMany: vi.fn().mockResolvedValue({ count }),
      },
    }) as unknown as Prisma.TransactionClient;

  it("takes the question for this turn; the same turn may take it again", async () => {
    const client = tx(1);
    await claimAccountQuestion(client, QUESTION, "turn-now");
    expect(
      vi.mocked(client.sokoBotAccountQuestion.updateMany).mock.calls[0]?.[0],
    ).toEqual({
      where: {
        id: QUESTION,
        OR: [{ answeredTurnId: null }, { answeredTurnId: "turn-now" }],
      },
      data: { answeredTurnId: "turn-now" },
    });
  });

  it("refuses, so the draft rolls back, when another turn took it", async () => {
    await expect(
      claimAccountQuestion(tx(0), QUESTION, "turn-now"),
    ).rejects.toThrow(/another turn/);
  });
});
