import { describe, expect, it } from "vitest";
import {
  chatCatchUpBucket,
  chatOpenLoopKind,
  OPEN_QUESTION_AFTER_MS,
  parseChatSignalProbabilities,
  type StoredChatSignal,
  sqlChatSignalHasTag,
  toChatMessageSignalDto,
} from "./derive";
import type { ChatSignalTag } from "./tags";

function signal(overrides: Partial<StoredChatSignal> = {}): StoredChatSignal {
  return {
    state: "tagged",
    probabilities: { question: 0.95 },
    addressedUserIds: ["alice"],
    commitmentDueAt: null,
    loopClosedAt: null,
    loopTaskId: null,
    corrections: [],
    ...overrides,
  };
}

describe("toChatMessageSignalDto", () => {
  it("is null until the message is tagged", () => {
    expect(toChatMessageSignalDto(null)).toBeNull();
    expect(toChatMessageSignalDto(signal({ state: "pending" }))).toBeNull();
  });

  it("lists the applying tags with corrections, in vocabulary order", () => {
    const dto = toChatMessageSignalDto(
      signal({
        probabilities: { urgent: 0.9, question: 0.95, fyi: 0.2 },
        corrections: [{ tag: "fyi", applies: true }],
      }),
    );
    expect(dto?.tags).toEqual(["question", "fyi", "urgent"]);
    expect(dto?.correctedTags).toEqual(["fyi"]);
  });

  it("keeps a due date only while the commitment tag applies", () => {
    const dueAt = new Date("2026-10-23T23:59:59Z");
    expect(
      toChatMessageSignalDto(
        signal({ probabilities: { commitment: 0.9 }, commitmentDueAt: dueAt }),
      )?.commitmentDueAt,
    ).toEqual(dueAt);
    expect(
      toChatMessageSignalDto(
        signal({
          probabilities: { commitment: 0.9 },
          commitmentDueAt: dueAt,
          corrections: [{ tag: "commitment", applies: false }],
        }),
      )?.commitmentDueAt,
    ).toBeNull();
  });
});

describe("parseChatSignalProbabilities", () => {
  it("drops unknown tags and values out of range", () => {
    expect(
      parseChatSignalProbabilities({
        question: 0.5,
        spam: 1,
        fyi: 3,
        urgent: "x",
      }),
    ).toEqual({ question: 0.5 });
    expect(parseChatSignalProbabilities(null)).toEqual({});
  });
});

describe("chatCatchUpBucket", () => {
  it("puts what asks the viewer first, then the most pressing tag", () => {
    const tags = new Set<ChatSignalTag>(["question", "urgent", "fyi"]);
    expect(chatCatchUpBucket(tags, ["alice"], "alice")).toBe("needsYou");
    expect(chatCatchUpBucket(tags, ["bob"], "alice")).toBe("urgent");
    expect(chatCatchUpBucket(new Set(["fyi"]), [], "alice")).toBe("fyi");
    expect(chatCatchUpBucket(new Set(), [], "alice")).toBeNull();
  });
});

describe("chatOpenLoopKind", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const old = new Date(now.getTime() - OPEN_QUESTION_AFTER_MS);
  const fresh = new Date(now.getTime() - OPEN_QUESTION_AFTER_MS + 60_000);

  it("opens a loop for a question unanswered for a few hours", () => {
    const base = {
      signal: signal(),
      viewerId: "alice",
      senderUserId: "bob",
      viewerRepliedAfter: false,
      now,
    };
    expect(chatOpenLoopKind({ ...base, sentAt: old })).toBe("question");
    expect(chatOpenLoopKind({ ...base, sentAt: fresh })).toBeNull();
    expect(
      chatOpenLoopKind({ ...base, sentAt: old, viewerRepliedAfter: true }),
    ).toBeNull();
    expect(
      chatOpenLoopKind({
        ...base,
        sentAt: old,
        signal: signal({ probabilities: { needsDecision: 0.9 } }),
      }),
    ).toBe("decision");
    expect(
      chatOpenLoopKind({
        ...base,
        sentAt: old,
        signal: signal({ loopClosedAt: now }),
      }),
    ).toBeNull();
  });

  it("opens a loop for the viewer's own commitment once its date passed", () => {
    const base = {
      viewerId: "alice",
      senderUserId: "alice",
      sentAt: old,
      viewerRepliedAfter: false,
      now,
    };
    const committed = (dueAt: Date) =>
      signal({
        probabilities: { commitment: 0.95 },
        addressedUserIds: [],
        commitmentDueAt: dueAt,
      });
    expect(
      chatOpenLoopKind({
        ...base,
        signal: committed(new Date(now.getTime() - 1)),
      }),
    ).toBe("commitment");
    expect(
      chatOpenLoopKind({
        ...base,
        signal: committed(new Date(now.getTime() + 1)),
      }),
    ).toBeNull();
    expect(
      chatOpenLoopKind({
        ...base,
        senderUserId: "bob",
        signal: committed(new Date(now.getTime() - 1)),
      }),
    ).toBeNull();
  });
});

describe("sqlChatSignalHasTag", () => {
  it("reads the newest correction before the probability", () => {
    const sql = sqlChatSignalHasTag("s", "decisionMade");
    expect(sql).toContain(`correction.tag = 'decisionMade'`);
    expect(sql).toContain(`ORDER BY correction."updatedAt" DESC`);
    expect(sql).toContain(`(s.probabilities->>'decisionMade')::float`);
  });

  it("refuses a tag outside the vocabulary", () => {
    expect(() =>
      sqlChatSignalHasTag("s", "x' OR 1=1 --" as ChatSignalTag),
    ).toThrow();
  });
});
