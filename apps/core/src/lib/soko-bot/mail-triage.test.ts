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

import {
  MAIL_TRIAGE_CRITERIA,
  mailTriageTag,
  type TriagedMail,
  triagedMailLines,
  triageMail,
} from "./mail-triage";

const mail = (
  id: string,
  subject: string,
  from = "someone@example.com",
  labels: string[] = [],
): SokoBotInboxMessage => ({
  provider: "gmail",
  id,
  threadId: null,
  from,
  to: ["owner@example.com"],
  subject,
  snippet: subject,
  receivedAt: "2026-10-10T08:00:00.000Z",
  unread: true,
  labels,
});

const choice = (URGENT: number, NOTABLE: number, BULK: number) => {
  const probabilities = { URGENT, NOTABLE, BULK };
  const [best] = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  return { type: "choice", choice: best[0], probabilities };
};

const triage = (inbox: SokoBotInboxMessage[]) =>
  triageMail({ sokoBotId: "bot-1", mail: inbox, source: "delta" });

describe("mailTriageTag", () => {
  it("tags URGENT only when Jev is sure enough to interrupt", () => {
    expect(
      mailTriageTag({
        type: "choice",
        choice: "URGENT",
        probabilities: { URGENT: 0.7, NOTABLE: 0.2, BULK: 0.1 },
      }),
    ).toEqual({ tag: "URGENT", probability: 0.7 });
  });

  it("counts an unsure URGENT toward NOTABLE, so it still reaches the briefing", () => {
    expect(
      mailTriageTag({
        type: "choice",
        choice: "URGENT",
        probabilities: { URGENT: 0.5, NOTABLE: 0.1, BULK: 0.4 },
      }),
    ).toEqual({ tag: "NOTABLE", probability: 0.6 });
  });

  it("tags BULK when that is the likelier rest", () => {
    expect(
      mailTriageTag({
        type: "choice",
        choice: "BULK",
        probabilities: { URGENT: 0.05, NOTABLE: 0.15, BULK: 0.8 },
      }),
    ).toEqual({ tag: "BULK", probability: 0.8 });
  });

  it("leaves a mail Jev did not answer untagged", () => {
    expect(mailTriageTag(undefined)).toEqual({ tag: null, probability: null });
    expect(mailTriageTag({ type: "boolean", probability: 1 })).toEqual({
      tag: null,
      probability: null,
    });
  });
});

describe("triageMail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryMock.mockResolvedValue(null);
    flaggedMock.mockResolvedValue([]);
  });

  it("asks one choice question per mail in one call, with the owner's context", async () => {
    memoryMock.mockResolvedValue({
      markdown:
        "# Soko Bot memory\n\n## Preferences\n\n- Do not flag Make scenario errors or DigitalOcean deployment failures.\n",
    });
    flaggedMock.mockResolvedValue([
      { finalAnswer: "Stripe: your payout failed." },
    ]);
    evaluateMock.mockResolvedValue({
      answers: { mail0: choice(0.1, 0.2, 0.7), mail1: choice(0.9, 0.1, 0) },
    });
    const inbox = [
      mail("a", "[Make] Scenario encountered an error"),
      mail("b", "Payout failed"),
    ];
    const { mail: tagged, failed } = await triage(inbox);
    expect(failed).toBe(false);
    expect(tagged).toEqual([
      { message: inbox[0], tag: "BULK", probability: 0.7, matchesRule: false },
      {
        message: inbox[1],
        tag: "URGENT",
        probability: 0.9,
        matchesRule: false,
      },
    ]);
    expect(evaluateMock).toHaveBeenCalledOnce();
    const { state, questions } = evaluateMock.mock.calls[0][0];
    expect(state.ownerPreferences).toEqual([
      "Do not flag Make scenario errors or DigitalOcean deployment failures.",
    ]);
    expect(state.alreadyFlaggedToday).toEqual(["Stripe: your payout failed."]);
    expect(Object.keys(questions)).toEqual([
      "mail0",
      "rule0",
      "mail1",
      "rule1",
    ]);
    expect(questions.mail0).toMatchObject({
      type: "choice",
      criteria: MAIL_TRIAGE_CRITERIA,
    });
    expect(questions.mail0.instructions).toMatch(/ownerPreferences/);
    expect(questions.mail0.instructions).toMatch(/alreadyFlaggedToday/);
    expect(MAIL_TRIAGE_CRITERIA.URGENT).toMatch(/DigitalOcean.*never urgent/);
  });

  it("marks mail a saved rule asks the bot to act on, only when Jev is sure", async () => {
    memoryMock.mockResolvedValue({
      markdown:
        "# Soko Bot memory\n\n## Decisions\n\n- Save invoice attachments into Finance/Invoices.\n",
    });
    evaluateMock.mockResolvedValue({
      answers: {
        mail0: choice(0, 0.2, 0.8),
        rule0: { type: "boolean", probability: 0.9 },
        mail1: choice(0, 0.2, 0.8),
        rule1: { type: "boolean", probability: 0.4 },
      },
    });
    const { mail: tagged } = await triage([
      mail("a", "Invoice #42"),
      mail("b", "Weekly digest"),
    ]);
    expect(tagged.map((item) => item.matchesRule)).toEqual([true, false]);
    const { state, questions } = evaluateMock.mock.calls[0][0];
    expect(state.ownerRules).toEqual([
      "Save invoice attachments into Finance/Invoices.",
    ]);
    expect(questions.rule0).toMatchObject({ type: "boolean" });
    expect(questions.rule0.instructions).toMatch(/ownerRules/);
  });

  it("asks no rule questions when the owner saved none", async () => {
    evaluateMock.mockResolvedValue({ answers: { mail0: choice(0, 0, 1) } });
    const { mail: tagged } = await triage([mail("a", "Invoice")]);
    expect(Object.keys(evaluateMock.mock.calls[0][0].questions)).toEqual([
      "mail0",
    ]);
    expect(tagged[0].matchesRule).toBe(false);
  });

  it("logs every tag without subjects or senders", async () => {
    evaluateMock.mockResolvedValue({
      answers: { mail0: choice(0.03, 0.12, 0.85) },
      providerMetadata: { gateway: { cost: "0.0004" } },
    });
    await triage([
      mail("a", "Secret subject", "Ana <ana@x.com>", ["CATEGORY_PROMOTIONS"]),
    ]);
    const logged = logSetMock.mock.calls[0][0];
    expect(logged).toEqual({
      sokoBot: { id: "bot-1" },
      mailTriage: {
        source: "delta",
        model: "typesafe-ai/jev",
        urgentThreshold: 0.7,
        checked: 1,
        urgent: 0,
        notable: 0,
        bulk: 1,
        matchesRule: 0,
        failed: false,
        costUsd: 0.0004,
        preferences: 0,
        alreadyFlagged: 0,
        tags: [
          {
            tag: "BULK",
            probability: 0.85,
            provider: "gmail",
            category: "CATEGORY_PROMOTIONS",
            unread: true,
          },
        ],
      },
    });
    expect(JSON.stringify(logged)).not.toMatch(/Secret|ana@/);
  });

  it("returns every mail untagged and logs the failure when Jev fails", async () => {
    evaluateMock.mockRejectedValue(new Error("timeout"));
    const inbox = [mail("a", "Hi")];
    const result = await triage(inbox);
    expect(result.failed).toBe(true);
    expect(result.mail).toEqual([
      { message: inbox[0], tag: null, probability: null, matchesRule: false },
    ]);
    expect(logSetMock.mock.calls[0][0].mailTriage.failed).toBe(true);
  });

  it("asks nothing for an empty inbox", async () => {
    expect((await triage([])).mail).toEqual([]);
    expect(evaluateMock).not.toHaveBeenCalled();
  });
});

describe("triagedMailLines", () => {
  const tagged = (
    id: string,
    tag: TriagedMail["tag"],
    from = "someone@example.com",
  ): TriagedMail => ({
    message: mail(id, `Subject ${id}`, from),
    tag,
    probability: tag ? 0.9 : null,
    matchesRule: false,
  });

  it("puts urgent first, notable after, bulk only as a count by sender", () => {
    const lines = triagedMailLines({
      timeZone: "UTC",
      limit: 40,
      mail: [
        tagged("n1", "NOTABLE"),
        tagged("b1", "BULK", "GitHub <notifications@github.com>"),
        tagged("u1", "URGENT"),
        tagged("b2", "BULK", "GitHub <notifications@github.com>"),
        tagged("b3", "BULK", "newsletter@substack.com"),
        tagged("x1", null),
      ],
    }).join("\n");
    expect(lines).toContain("## Mail (6), triaged by Jev");
    expect(lines.indexOf("### Urgent (1)")).toBeLessThan(
      lines.indexOf("### Notable (1)"),
    );
    expect(lines).toContain(
      "**Subject u1** — Subject u1 [gmail:u1] · urgent 90%",
    );
    expect(lines).toContain("[gmail:n1] · notable 90%");
    expect(lines).toContain(
      "### Bulk (3)\n- GitHub ×2, newsletter@substack.com (search_inbox to read any of them)",
    );
    expect(lines).not.toContain("Subject b1");
    expect(lines).toContain("### Not triaged (1)");
    expect(lines).toMatch(/\[gmail:x1\]$/m);
  });

  it("lists rule-matching mail first and in full, even when bulk", () => {
    const lines = triagedMailLines({
      timeZone: "UTC",
      limit: 40,
      mail: [
        tagged("b1", "BULK"),
        { ...tagged("inv", "BULK", "billing@acme.com"), matchesRule: true },
      ],
    }).join("\n");
    expect(lines).toContain(
      "### Matches a saved rule of the owner's: act on it (1)",
    );
    expect(lines).toContain("[gmail:inv] · bulk 90%");
    expect(lines).toContain("### Bulk (1)");
  });

  it("is empty without mail and marks a full fetch", () => {
    expect(triagedMailLines({ timeZone: "UTC", limit: 1, mail: [] })).toEqual(
      [],
    );
    expect(
      triagedMailLines({
        timeZone: "UTC",
        limit: 1,
        mail: [tagged("u1", "URGENT")],
      })[0],
    ).toBe("## Mail (1+), triaged by Jev");
  });
});
