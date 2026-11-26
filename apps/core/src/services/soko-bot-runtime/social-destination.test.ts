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
  ...turns: { finalAnswer: string; refused?: boolean; posted?: boolean }[]
) {
  db.turnFindMany.mockResolvedValue(
    turns.map((earlier) => ({
      finalAnswer: earlier.finalAnswer,
      toolCalls: [
        ...(earlier.refused ? [{ status: "FAILED" }] : []),
        ...(earlier.posted ? [{ status: "COMPLETED" }] : []),
      ],
    })),
  );
}

function previousTurn(finalAnswer: string, refused = false) {
  earlierTurns({ finalAnswer, refused });
}

const check = (params: typeof onCompany | { projectId: string }) =>
  requireChosenSocialDestination(turn(), params);

beforeEach(() => {
  vi.clearAllMocks();
  db.connectionFindFirst.mockResolvedValue({ provider: "x" });
  db.connectionFindMany.mockResolvedValue(candidates);
  db.turnFindMany.mockResolvedValue([]);
});

describe("requireChosenSocialDestination", () => {
  it("refuses a draft when two accounts fit and none was chosen, listing them", async () => {
    ownerSays("Write an X post about how our harness works.");
    const refusal = check(onCompany);
    await expect(refusal).rejects.toThrow(ASK_WHICH_ACCOUNT);
    await expect(refusal).rejects.toThrow(/@acme_hq .*@pat /);
  });

  it("never reads a name inside a longer word (Pat in patch)", async () => {
    ownerSays("Draft an X post about our latest patch.");
    await expect(check(onPersonal)).rejects.toThrow(ASK_WHICH_ACCOUNT);
  });

  it("does not take a name the post is about for the answer", async () => {
    ownerSays("Draft an X post about acme_hq's launch.");
    previousTurn("Which account: @acme_hq or @pat?");
    await expect(check(onPersonal)).rejects.toThrow(/has not picked/);
    await expect(check(onCompany)).rejects.toThrow(/has not picked/);
  });

  it("goes ahead when the owner chose by @handle or Project name", async () => {
    for (const message of [
      "Post this on @pat: shipping today.",
      "Draft it for Founder notes.",
    ]) {
      ownerSays(message);
      await expect(check(onPersonal)).resolves.toBeUndefined();
    }
    // A bare handle is as likely the post's topic: it is asked.
    ownerSays("Write about pat for this one.");
    await expect(check(onPersonal)).rejects.toThrow(ASK_WHICH_ACCOUNT);
  });

  it("reads no destination from quoted or fenced post copy", async () => {
    for (const message of [
      'Post this: "Big thanks to @pat for the help!"',
      "Post this:\n```\nShipped with @pat today\n```",
      "Post this:\n> Shipped with @pat today",
    ]) {
      ownerSays(message);
      await expect(check(onPersonal)).rejects.toThrow(ASK_WHICH_ACCOUNT);
    }
  });

  it("binds the draft to the owner's answer, by place in the question", async () => {
    ownerSays("the second one");
    previousTurn("Which account: @acme_hq (Company marketing) or @pat?");
    await expect(check(onPersonal)).resolves.toBeUndefined();
    await expect(check(onCompany)).rejects.toThrow(/owner chose @pat /);
    // The question's order, not the accounts' age.
    previousTurn("Which account: @pat or @acme_hq?");
    await expect(check(onCompany)).resolves.toBeUndefined();
    await expect(check(onPersonal)).rejects.toThrow(/owner chose @acme_hq /);
  });

  it("binds the draft to the account the owner named in the answer", async () => {
    ownerSays("@acme_hq please");
    previousTurn("Which account: @acme_hq or @pat?");
    await expect(check(onPersonal)).rejects.toThrow(/owner chose @acme_hq /);
    await expect(check(onCompany)).resolves.toBeUndefined();
  });

  it("drafts on each account when the owner answers both", async () => {
    ownerSays("both");
    previousTurn("Which account: @acme_hq or @pat?");
    await expect(check(onCompany)).resolves.toBeUndefined();
    await expect(check(onPersonal)).resolves.toBeUndefined();
  });

  it("checks the chosen account among every eligible one, listing only ten", async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `01960001-0001-7001-8001-0000000001${String(index).padStart(2, "0")}`,
      externalHandle: `brand_${index}`,
      project: { id: `p${index}`, name: `Brand ${index} team` },
    }));
    db.connectionFindMany.mockResolvedValue(many);
    ownerSays("Post it on @brand_11.");
    await expect(
      check({ projectId: "p11", socialConnectionId: many[11]?.id ?? "" }),
    ).resolves.toBeUndefined();
    ownerSays("Write an X post.");
    await expect(
      check({ projectId: "p0", socialConnectionId: many[0]?.id ?? "" }),
    ).rejects.toThrow(/and 2 more/);
    expect(db.connectionFindMany.mock.calls[0]?.[0].take).toBeUndefined();
  });

  it("sends the post to the @handle the owner chose", async () => {
    ownerSays("Put it on @pat.");
    await expect(check(onCompany)).rejects.toThrow(/owner chose @pat /);
    await expect(check({ projectId: "p1" })).rejects.toThrow(
      /owner chose @pat .*socialConnectionId/,
    );
  });

  it("drafts on the answer after Core refused with the question", async () => {
    ownerSays("the second one");
    previousTurn("Which one should I use?", true);
    await expect(check(onPersonal)).resolves.toBeUndefined();
  });

  it("drafts on the answer after the bot asked on its own, without a refused draft", async () => {
    ownerSays("the second one");
    previousTurn("Which account: @acme_hq (Company marketing) or @pat?");
    await expect(check(onPersonal)).resolves.toBeUndefined();
  });

  it("looks for the question only just before, in this chat", async () => {
    ownerSays("the second one");
    await check(onPersonal).catch(() => undefined);
    const [{ where }] = db.turnFindMany.mock.calls[0];
    expect(where.destinationRoomId).toBeNull();
    expect(where.createdAt.lt).toEqual(NOW);
    expect(where.createdAt.gte).toEqual(new Date(NOW.getTime() - 86_400_000));
  });

  it("never posts on an account the owner turned down, and keeps asking", async () => {
    ownerSays("Not @acme_hq, use my personal account!");
    previousTurn("Which account: @acme_hq or @pat?");
    await expect(check(onCompany)).rejects.toThrow(/has not picked/);
    await expect(check(onPersonal)).rejects.toThrow(/has not picked/);
    db.turnFindMany.mockResolvedValue([]);
    await expect(check(onPersonal)).rejects.toThrow(ASK_WHICH_ACCOUNT);
  });

  it("keeps the question open while the owner has not picked", async () => {
    ownerSays("Please wait, I have not picked an account");
    previousTurn("Which account: @acme_hq or @pat?");
    await expect(check(onCompany)).rejects.toThrow(/has not picked/);
    // Answered a turn later, the open question still counts.
    ownerSays("the second one");
    earlierTurns(
      { finalAnswer: "Sure, take your time." },
      { finalAnswer: "Which account: @acme_hq or @pat?" },
    );
    await expect(check(onPersonal)).resolves.toBeUndefined();
    // A post saved after the question closes it.
    earlierTurns(
      { finalAnswer: "Drafted.", posted: true },
      { finalAnswer: "Which account: @acme_hq or @pat?" },
    );
    await expect(check(onPersonal)).rejects.toThrow(ASK_WHICH_ACCOUNT);
  });

  it("reads no destination from single-quoted copy", async () => {
    ownerSays("Post this: 'Big thanks to @pat for the help!'");
    await expect(check(onPersonal)).rejects.toThrow(ASK_WHICH_ACCOUNT);
    // An apostrophe is not a quote.
    ownerSays("It's for @pat's account");
    await expect(check(onPersonal)).resolves.toBeUndefined();
  });

  it("reads a place in the list among the options shown, not every account", async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `01960001-0001-7001-8001-0000000002${String(index).padStart(2, "0")}`,
      externalHandle: `brand_${index}`,
      project: { id: `p${index}`, name: `Brand ${index} team` },
    }));
    db.connectionFindMany.mockResolvedValue(many);
    ownerSays("the last one");
    previousTurn("", true);
    await expect(
      check({ projectId: "p11", socialConnectionId: many[11]?.id ?? "" }),
    ).rejects.toThrow(/owner chose @brand_9 /);
    await expect(
      check({ projectId: "p9", socialConnectionId: many[9]?.id ?? "" }),
    ).resolves.toBeUndefined();
  });

  it("still asks when the named Project holds two accounts of the network", async () => {
    db.connectionFindMany.mockResolvedValue([
      candidates[0],
      { ...candidates[1], project: candidates[0]?.project },
    ]);
    ownerSays("Write an X post for Company marketing.");
    await expect(check(onCompany)).rejects.toThrow(ASK_WHICH_ACCOUNT);
    ownerSays("Write it for Company marketing on @pat.");
    await expect(
      check({ projectId: "p1", socialConnectionId: PERSONAL }),
    ).resolves.toBeUndefined();
  });

  it("drafts on each account when the owner chose several", async () => {
    ownerSays("Post it on @acme_hq and on @pat.");
    await expect(check(onCompany)).resolves.toBeUndefined();
    await expect(check(onPersonal)).resolves.toBeUndefined();
  });

  it("ignores closed Projects and a question from a failed turn", async () => {
    ownerSays("the second one");
    await check(onPersonal).catch(() => undefined);
    const [{ where: connections }] = db.connectionFindMany.mock.calls[0];
    expect(connections.project).toMatchObject({
      closedAt: null,
      closingAt: null,
    });
    const [{ where: previous }] = db.turnFindMany.mock.calls[0];
    expect(previous.OR).toContainEqual({ status: "COMPLETED" });
  });

  it("names the answered account when the draft names none", async () => {
    ownerSays("the second one");
    // Core's refusal listed them oldest first.
    previousTurn("", true);
    await expect(check({ projectId: "p2" })).rejects.toThrow(
      /owner chose @pat .*socialConnectionId/,
    );
    ownerSays("my personal one, please");
    await expect(check({ projectId: "p2" })).rejects.toThrow(/has not picked/);
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
