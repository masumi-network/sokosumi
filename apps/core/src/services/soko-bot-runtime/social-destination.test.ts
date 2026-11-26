import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  connectionFindFirst: vi.fn(),
  connectionFindMany: vi.fn(),
  turnFindUnique: vi.fn(),
  turnFindFirst: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSocialConnection: {
      findFirst: db.connectionFindFirst,
      findMany: db.connectionFindMany,
    },
    sokoBotTurn: {
      findUniqueOrThrow: db.turnFindUnique,
      findFirst: db.turnFindFirst,
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

function previousTurn(finalAnswer: string, refused = false) {
  db.turnFindFirst.mockResolvedValue({
    finalAnswer,
    toolCalls: refused ? [{ id: "refused" }] : [],
  });
}

const check = (params: typeof onCompany | { projectId: string }) =>
  requireChosenSocialDestination(turn(), params);

beforeEach(() => {
  vi.clearAllMocks();
  db.connectionFindFirst.mockResolvedValue({ provider: "x" });
  db.connectionFindMany.mockResolvedValue(candidates);
  db.turnFindFirst.mockResolvedValue(null);
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

  it("does not redirect when a name is only the post's topic", async () => {
    ownerSays("Draft an X post about acme_hq's launch.");
    previousTurn("Which account: @acme_hq or @pat?");
    await expect(check(onPersonal)).resolves.toBeUndefined();
  });

  it("goes ahead when the owner chose by @handle, handle, or Project name", async () => {
    for (const message of [
      "Post this on @pat: shipping today.",
      "Use pat for this one.",
      "Draft it for Founder notes.",
    ]) {
      ownerSays(message);
      await expect(check(onPersonal)).resolves.toBeUndefined();
    }
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
    const [{ where }] = db.turnFindFirst.mock.calls[0];
    expect(where.destinationRoomId).toBeNull();
    expect(where.createdAt.lt).toEqual(NOW);
    expect(where.createdAt.gte).toEqual(new Date(NOW.getTime() - 86_400_000));
  });

  it("asks for the id when the owner answered but the draft names no account", async () => {
    ownerSays("the second one");
    previousTurn("", true);
    await expect(check({ projectId: "p2" })).rejects.toThrow(
      /Pass the socialConnectionId/,
    );
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
