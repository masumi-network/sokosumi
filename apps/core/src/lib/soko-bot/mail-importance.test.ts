import type { SokoBotInboxMessage } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateMock, logSetMock } = vi.hoisted(() => ({
  evaluateMock: vi.fn(),
  logSetMock: vi.fn(),
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
  beforeEach(() => vi.clearAllMocks());

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
