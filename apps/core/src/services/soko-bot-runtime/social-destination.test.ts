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
    sokoBotTurn: { findUnique: db.turnFindUnique, findFirst: db.turnFindFirst },
  },
}));

import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";
import {
  ASK_WHICH_ACCOUNT,
  requireChosenSocialDestination,
} from "./social-destination";

const COMPANY = "01960001-0001-7001-8001-0000000000a1";
const PERSONAL = "01960001-0001-7001-8001-0000000000a2";
const candidates = [
  {
    id: COMPANY,
    externalHandle: "acme_hq",
    displayName: "Acme",
    project: { id: "p1", name: "Company marketing" },
  },
  {
    id: PERSONAL,
    externalHandle: "pat_builds",
    displayName: "Pat",
    project: { id: "p2", name: "Founder notes" },
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

function says(message: string) {
  db.turnFindUnique.mockResolvedValue({ userMessage: message });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.connectionFindFirst.mockResolvedValue({ provider: "x" });
  db.connectionFindMany.mockResolvedValue(candidates);
  db.turnFindFirst.mockResolvedValue({ toolCalls: [] });
});

describe("requireChosenSocialDestination", () => {
  it("refuses a draft when two accounts fit and the owner named none, with the question to ask", async () => {
    says("Write an X post about how our harness works, with three pictures.");
    const refusal = requireChosenSocialDestination(turn(), {
      projectId: "p1",
      socialConnectionId: COMPANY,
    });
    await expect(refusal).rejects.toThrow(ASK_WHICH_ACCOUNT);
    await expect(refusal).rejects.toThrow(/@acme_hq .*@pat_builds/);
  });

  it("lets the draft through once the owner answers on the next turn", async () => {
    says("the second one");
    db.turnFindFirst.mockResolvedValue({ toolCalls: [{ id: "refused" }] });
    await expect(
      requireChosenSocialDestination(turn(), {
        projectId: "p2",
        socialConnectionId: PERSONAL,
      }),
    ).resolves.toBeUndefined();
  });

  it("goes ahead when the owner named the account or its Project", async () => {
    for (const message of [
      "Post this on @pat_builds: shipping today.",
      "Draft it for Founder notes.",
    ]) {
      says(message);
      await expect(
        requireChosenSocialDestination(turn(), {
          projectId: "p2",
          socialConnectionId: PERSONAL,
        }),
      ).resolves.toBeUndefined();
    }
  });

  it("refuses the other account when the owner named one", async () => {
    says("Put it on @pat_builds.");
    await expect(
      requireChosenSocialDestination(turn(), {
        projectId: "p1",
        socialConnectionId: COMPANY,
      }),
    ).rejects.toThrow(/owner named @pat_builds/);
  });

  it("asks nothing with one fitting account, on a turn the owner did not type, or for Cuso", async () => {
    says("Write an X post.");
    db.connectionFindMany.mockResolvedValueOnce([candidates[0]]);
    await expect(
      requireChosenSocialDestination(turn(), {
        projectId: "p1",
        socialConnectionId: COMPANY,
      }),
    ).resolves.toBeUndefined();
    for (const other of [
      turn({ source: "SCHEDULE" }),
      turn({ versionId: "cmo-v23" }),
    ])
      await expect(
        requireChosenSocialDestination(other, {
          projectId: "p1",
          socialConnectionId: COMPANY,
        }),
      ).resolves.toBeUndefined();
  });
});
