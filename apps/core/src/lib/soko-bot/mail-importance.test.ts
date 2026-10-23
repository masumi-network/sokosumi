import type { SokoBotInboxMessage } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateMock, logSetMock, memoryMock, flaggedMock } = vi.hoisted(
  () => ({
    evaluateMock: vi.fn(),
    logSetMock: vi.fn(),
    memoryMock: vi.fn(),
    flaggedMock: vi.fn(),
  }),
);
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotMemoryRevision: { findFirst: memoryMock },
    sokoBotTurn: { findMany: flaggedMock },
  },
}));
vi.mock("ai", () => ({
  experimental_evaluate: evaluateMock,
  gateway: { evaluationModel: vi.fn() },
}));
vi.mock("@/lib/evlog", () => ({
  createCoreLogger: () => ({ set: logSetMock, emit: vi.fn() }),
}));

import { checkMailImportance } from "./mail-importance";

const mail = (
  id: string,
  subject: string,
  labels: string[] = [],
): SokoBotInboxMessage => ({
  provider: "gmail",
  id,
  threadId: null,
  from: "someone@example.com",
  to: ["owner@example.com"],
  subject,
  snippet: subject,
  receivedAt: "2026-10-10T08:00:00.000Z",
  unread: true,
  labels,
});

const check = (inbox: SokoBotInboxMessage[]) =>
  checkMailImportance({ sokoBotId: "bot-1", mail: inbox, source: "ingest" });

describe("checkMailImportance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryMock.mockResolvedValue(null);
    flaggedMock.mockResolvedValue([]);
  });

  it("lets Jev weigh the owner's preferences and what was flagged today", async () => {
    memoryMock.mockResolvedValue({
      markdown:
        "# Soko Bot memory\n\n## Preferences\n\n- Do not flag Make scenario errors or DigitalOcean deployment failures.\n",
    });
    flaggedMock.mockResolvedValue([
      { finalAnswer: "Make — s_New_Registration: two recent errors." },
    ]);
    evaluateMock.mockResolvedValue({
      answers: { mail0: { probability: 0.1 } },
    });
    const { important } = await check([
      mail("a", "[Make] Scenario s_New_Registration encountered an error"),
    ]);
    expect(important).toEqual([]);
    const { state, questions } = evaluateMock.mock.calls[0][0];
    expect(state.ownerPreferences).toEqual([
      "Do not flag Make scenario errors or DigitalOcean deployment failures.",
    ]);
    expect(state.alreadyFlaggedToday).toEqual([
      "Make — s_New_Registration: two recent errors.",
    ]);
    expect(questions.mail0.instructions).toMatch(/ownerPreferences/);
  });

  it("keeps only the mail Jev is sure needs the owner now", async () => {
    evaluateMock.mockResolvedValue({
      answers: {
        mail0: { probability: 0.95 },
        mail1: { probability: 0.4 },
        mail2: { probability: 0.7 },
      },
    });
    const inbox = [
      mail("a", "Contract to sign by today"),
      mail("b", "Weekly newsletter", ["CATEGORY_PROMOTIONS"]),
      mail("c", "Can we move tomorrow's call?"),
    ];
    const { important } = await check(inbox);
    expect(important).toEqual([inbox[0], inbox[2]]);
    expect(Object.keys(evaluateMock.mock.calls[0][0].questions)).toEqual([
      "mail0",
      "mail1",
      "mail2",
    ]);
  });

  it("logs every rating without subjects or senders", async () => {
    evaluateMock.mockResolvedValue({
      answers: { mail0: { probability: 0.123 } },
    });
    await check([mail("a", "Secret subject", ["CATEGORY_PROMOTIONS"])]);
    const logged = logSetMock.mock.calls[0][0];
    expect(logged).toEqual({
      sokoBot: { id: "bot-1" },
      mailImportance: {
        source: "ingest",
        model: "typesafe-ai/jev",
        threshold: 0.7,
        checked: 1,
        important: 0,
        failed: false,
        preferences: 0,
        alreadyFlagged: 0,
        ratings: [
          {
            probability: 0.12,
            important: false,
            provider: "gmail",
            category: "CATEGORY_PROMOTIONS",
            unread: true,
          },
        ],
      },
    });
    expect(JSON.stringify(logged)).not.toMatch(/Secret|someone@/);
  });

  it("treats a mail Jev did not answer as not important", async () => {
    evaluateMock.mockResolvedValue({ answers: {} });
    expect((await check([mail("a", "Hi")])).important).toEqual([]);
  });

  it("returns null and logs the failure when Jev fails", async () => {
    evaluateMock.mockRejectedValue(new Error("timeout"));
    expect((await check([mail("a", "Hi")])).important).toBeNull();
    expect(logSetMock.mock.calls[0][0].mailImportance.failed).toBe(true);
  });

  it("asks nothing for an empty inbox", async () => {
    expect((await check([])).important).toEqual([]);
    expect(evaluateMock).not.toHaveBeenCalled();
  });
});
