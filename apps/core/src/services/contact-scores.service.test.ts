import { describe, expect, it, vi } from "vitest";
import { AiGatewayBudgetError } from "@/lib/ai-gateway-budget";
import prisma from "@/lib/db/prisma";
import { askJev } from "@/lib/soko-bot/jev";
import { expectCoreLog } from "@/test/core-log";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
    contact: { findUniqueOrThrow: vi.fn() },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ name: "Jane" }) },
    contactInteraction: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/soko-bot/jev", () => ({ askJev: vi.fn() }));

const { importanceFromAnswers, judgeWorkspaceImportance } = await import(
  "./contact-scores.service"
);

describe("judgeWorkspaceImportance", () => {
  it("stops after the first budget refusal without reporting another error", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { contactId: "contact-1", userId: "user-1", interactions: 1 },
      { contactId: "contact-2", userId: "user-1", interactions: 2 },
    ]);
    vi.mocked(prisma.contactInteraction.findMany).mockResolvedValue([]);
    vi.mocked(askJev).mockRejectedValue(new AiGatewayBudgetError());
    const stats = { judged: 0, failed: 0 };
    expectCoreLog("error", "Could not judge a contact's importance", 0);

    await judgeWorkspaceImportance({
      workspaceId: "workspace-1",
      budget: 2,
      stats,
      shouldContinue: () => true,
    });

    expect(askJev).toHaveBeenCalledTimes(1);
    expect(stats).toEqual({ judged: 0, failed: 1 });
  });
});

describe("importanceFromAnswers", () => {
  it("weighs decision power, value, live business and closeness", () => {
    expect(
      importanceFromAnswers(
        new Map([
          ["decides", 1],
          ["value", 1],
          ["active", 1],
          ["close", 1],
          ["noise", 0],
        ]),
      ),
    ).toEqual({
      importance: 100,
      reason: "decides,value,active,close",
    });
  });

  it("lets noise take most of it away, and names it", () => {
    expect(
      importanceFromAnswers(
        new Map([
          ["value", 1],
          ["noise", 1],
        ]),
      ),
    ).toEqual({ importance: 7, reason: "noise" });
  });

  it("treats a question Jev did not answer as no", () => {
    expect(importanceFromAnswers(new Map())).toEqual({
      importance: 0,
      reason: null,
    });
  });
});
