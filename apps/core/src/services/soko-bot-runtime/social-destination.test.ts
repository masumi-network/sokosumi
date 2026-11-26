import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  connectionFindFirst: vi.fn(),
  connectionFindMany: vi.fn(),
  turnFindUnique: vi.fn(),
  questionCreate: vi.fn(),
  questionFindUnique: vi.fn(),
  questionUpdateMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSocialConnection: {
      findFirst: db.connectionFindFirst,
      findMany: db.connectionFindMany,
    },
    sokoBotTurn: { findUniqueOrThrow: db.turnFindUnique },
    sokoBotAccountQuestion: {
      create: db.questionCreate,
      findUnique: db.questionFindUnique,
      updateMany: db.questionUpdateMany,
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
const QUESTION = "01960001-0001-7001-8001-0000000000f1";
const ASKED_AT = new Date("2026-11-26T09:00:00Z");
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

function openQuestion(overrides: Record<string, unknown> = {}) {
  db.questionFindUnique.mockResolvedValue({
    id: QUESTION,
    sokoBotId: "bot",
    requestedByUserId: "owner",
    turnId: "turn-asked",
    createdAt: ASKED_AT,
    optionIds: [COMPANY, PERSONAL],
    answeredTurnId: null,
    ...overrides,
  });
}

const check = (params: Parameters<typeof requireChosenSocialDestination>[1]) =>
  requireChosenSocialDestination(turn(), params);
const answer = (socialConnectionId: string, projectId: string) =>
  check({ projectId, socialConnectionId, accountQuestionId: QUESTION });

beforeEach(() => {
  vi.clearAllMocks();
  db.connectionFindFirst.mockResolvedValue({ provider: "x" });
  db.connectionFindMany.mockResolvedValue(candidates);
  db.questionCreate.mockResolvedValue({ id: QUESTION });
  db.questionUpdateMany.mockResolvedValue({ count: 1 });
});

describe("requireChosenSocialDestination", () => {
  it("records a question with its ordered options and refuses the first draft", async () => {
    ownerSays("Write an X post about our launch.");
    const refusal = check(onCompany);
    await expect(refusal).rejects.toThrow(ASK_WHICH_ACCOUNT);
    await expect(refusal).rejects.toThrow(
      new RegExp(`Account question ${QUESTION}.*@acme_hq .*@pat `),
    );
    expect(db.questionCreate.mock.calls[0]?.[0].data).toMatchObject({
      sokoBotId: "bot",
      turnId: "turn-now",
      requestedByUserId: "owner",
      provider: "x",
      optionIds: [COMPANY, PERSONAL],
    });
  });

  it("skips the question when the request names the account or its only-account Project", async () => {
    for (const message of [
      "Post this on @pat: shipping today.",
      `Use ${PERSONAL}.`,
      "Draft it for Founder notes.",
    ]) {
      ownerSays(message);
      await expect(check(onPersonal)).resolves.toBeUndefined();
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

  it("accepts the answer on a later owner turn, only among the options", async () => {
    openQuestion();
    db.turnFindUnique.mockResolvedValue({ createdAt: NOW });
    await expect(answer(PERSONAL, "p2")).resolves.toBeUndefined();
    expect(db.questionUpdateMany.mock.calls[0]?.[0].data).toEqual({
      answeredTurnId: "turn-now",
    });
    // The answering turn may draft on several options.
    openQuestion({ answeredTurnId: "turn-now" });
    await expect(answer(COMPANY, "p1")).resolves.toBeUndefined();
    openQuestion({ optionIds: [COMPANY] });
    await expect(answer(PERSONAL, "p2")).rejects.toThrow(
      /option the owner picked/,
    );
  });

  it("refuses an answer that is not open on this turn", async () => {
    db.turnFindUnique.mockResolvedValue({ createdAt: NOW });
    for (const closed of [
      { turnId: "turn-now" },
      { createdAt: NOW },
      { requestedByUserId: "someone-else" },
      { sokoBotId: "another-bot" },
      { answeredTurnId: "turn-earlier" },
      { createdAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) },
    ]) {
      openQuestion(closed);
      await expect(answer(PERSONAL, "p2")).rejects.toThrow(/not open/);
    }
    db.questionFindUnique.mockResolvedValue(null);
    await expect(answer(PERSONAL, "p2")).rejects.toThrow(/not open/);
  });

  it("lets one turn claim an answer when two race", async () => {
    openQuestion();
    db.turnFindUnique.mockResolvedValue({ createdAt: NOW });
    db.questionUpdateMany.mockResolvedValue({ count: 0 });
    await expect(answer(PERSONAL, "p2")).rejects.toThrow(/just answered/);
  });

  it("shows at most ten options, and names the rest by count", async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `01960001-0001-7001-8001-0000000004${String(index).padStart(2, "0")}`,
      externalHandle: `brand_${index}`,
      project: { id: `p${index}`, name: `Brand ${index}` },
    }));
    db.connectionFindMany.mockResolvedValue(many);
    ownerSays("Write an X post.");
    await expect(
      check({ projectId: "p0", socialConnectionId: many[0]?.id ?? "" }),
    ).rejects.toThrow(/2 more are connected/);
    expect(db.questionCreate.mock.calls[0]?.[0].data.optionIds).toHaveLength(
      10,
    );
    ownerSays("Post it on @brand_11.");
    await expect(
      check({ projectId: "p11", socialConnectionId: many[11]?.id ?? "" }),
    ).resolves.toBeUndefined();
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
    expect(db.questionCreate).not.toHaveBeenCalled();
  });
});
