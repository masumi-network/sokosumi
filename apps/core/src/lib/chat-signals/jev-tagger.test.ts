import { describe, expect, it, vi } from "vitest";
import {
  type ChatSignalBatch,
  chatSignalAddressees,
  chatSignalRequest,
  readChatSignalAnswers,
  tagChatSignalBatch,
} from "./jev-tagger";

const alice = { userId: "alice", name: "Alice" };
const bob = { userId: "bob", name: "Bob" };
const carla = { userId: "carla", name: "Carla" };

function batch(overrides: Partial<ChatSignalBatch> = {}): ChatSignalBatch {
  return {
    roomKind: "channel",
    roomName: "launch",
    people: [alice, bob, carla],
    earlier: [{ authorName: "Carla", text: "Morning all" }],
    messages: [
      {
        messageId: "m-1",
        authorUserId: "bob",
        authorName: "Bob",
        text: "Alice, can you send the pricing sheet?",
        mentionedUserIds: [],
      },
    ],
    ...overrides,
  };
}

describe("chatSignalRequest", () => {
  it("asks every tag but escalation, the due date and the addressee", () => {
    const { questions, state } = chatSignalRequest(batch());
    expect(Object.keys(questions).sort()).toEqual(
      [
        "m0_addressee",
        "m0_blocker",
        "m0_chitChat",
        "m0_commitment",
        "m0_decisionMade",
        "m0_due",
        "m0_fyi",
        "m0_needsDecision",
        "m0_question",
        "m0_urgent",
        "m0_workRequest",
      ].sort(),
    );
    expect(questions.m0_addressee).toMatchObject({
      type: "choice",
      criteria: { p0: "Alice", p1: "Carla", NOBODY: expect.any(String) },
    });
    expect(state).toMatchObject({
      people: ["Alice", "Bob", "Carla"],
      earlierMessages: [{ author: "Carla", text: "Morning all" }],
      messages: [{ key: "m0", author: "Bob" }],
    });
    // Message text is data in the state, never inside a question.
    expect(JSON.stringify(questions)).not.toContain("pricing sheet");
  });

  it("asks escalation only in an external channel", () => {
    expect(
      chatSignalRequest(batch({ roomKind: "external" })).questions,
    ).toHaveProperty("m0_escalation");
    expect(
      chatSignalRequest(batch({ roomKind: "direct" })).questions,
    ).not.toHaveProperty("m0_escalation");
  });

  it("does not ask who a mention or a pair already names", () => {
    const mentioned = batch();
    mentioned.messages[0].mentionedUserIds = ["alice"];
    expect(chatSignalRequest(mentioned).questions).not.toHaveProperty(
      "m0_addressee",
    );
    expect(
      chatSignalRequest(batch({ people: [alice, bob] })).questions,
    ).not.toHaveProperty("m0_addressee");
  });
});

function answers(overrides: Record<string, unknown> = {}) {
  return {
    m0_question: { probability: 0.99 },
    m0_needsDecision: { probability: 0.2 },
    m0_commitment: { probability: 0.01 },
    m0_blocker: { probability: 0.01 },
    m0_decisionMade: { probability: 0.01 },
    m0_fyi: { probability: 0.05 },
    m0_urgent: { probability: 0.1 },
    m0_chitChat: { probability: 0.01 },
    m0_workRequest: { probability: 0.1 },
    m0_due: { choice: "NONE", probabilities: { NONE: 0.9 } },
    m0_addressee: { choice: "p0", probabilities: { p0: 0.8, p1: 0.1 } },
    ...overrides,
  };
}

describe("readChatSignalAnswers", () => {
  it("reads probabilities, the due choice and the addressee", () => {
    const [reading] = readChatSignalAnswers(batch(), answers());
    expect(reading).toMatchObject({
      messageId: "m-1",
      probabilities: { question: 0.99, needsDecision: 0.2 },
      due: "NONE",
      addressee: { userId: "alice", probability: 0.8 },
    });
    expect(reading.probabilities).not.toHaveProperty("escalation");
  });

  it("drops an addressee Jev was unsure of, or one it named nobody", () => {
    const unsure = readChatSignalAnswers(
      batch(),
      answers({ m0_addressee: { choice: "p0", probabilities: { p0: 0.4 } } }),
    );
    expect(unsure[0].addressee).toBeNull();
    const nobody = readChatSignalAnswers(
      batch(),
      answers({
        m0_addressee: { choice: "NOBODY", probabilities: { NOBODY: 0.9 } },
      }),
    );
    expect(nobody[0].addressee).toBeNull();
  });

  it("falls back to NONE for an unknown due choice", () => {
    const [reading] = readChatSignalAnswers(
      batch(),
      answers({ m0_due: { choice: "YESTERDAY" } }),
    );
    expect(reading.due).toBe("NONE");
  });

  it("throws on a malformed answer, so the batch is retried", () => {
    expect(() =>
      readChatSignalAnswers(batch(), { m0_question: { probability: 2 } }),
    ).toThrow();
  });
});

describe("chatSignalAddressees", () => {
  it("prefers mentions, then the other person in a pair, then Jev's pick", () => {
    const mentioned = batch();
    mentioned.messages[0].mentionedUserIds = ["carla", "bob"];
    const reading = readChatSignalAnswers(batch(), answers())[0];
    // The author is never their own addressee.
    expect(
      chatSignalAddressees(mentioned, mentioned.messages[0], reading),
    ).toEqual(["carla"]);
    const pair = batch({ people: [alice, bob] });
    expect(
      chatSignalAddressees(pair, pair.messages[0], {
        ...reading,
        addressee: null,
      }),
    ).toEqual(["alice"]);
    const channel = batch();
    expect(chatSignalAddressees(channel, channel.messages[0], reading)).toEqual(
      ["alice"],
    );
    expect(
      chatSignalAddressees(channel, channel.messages[0], {
        ...reading,
        addressee: null,
      }),
    ).toEqual([]);
  });
});

describe("tagChatSignalBatch", () => {
  it("makes one call for the whole batch and reports its cost", async () => {
    const evaluate = vi.fn().mockResolvedValue({
      answers: answers(),
      costUsd: 0.0000335,
    });
    const result = await tagChatSignalBatch(batch(), {
      timeoutMs: 1_000,
      evaluate,
    });
    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate.mock.calls[0][0].timeoutMs).toBe(1_000);
    expect(result.questionCount).toBe(11);
    expect(result.costUsd).toBe(0.0000335);
    expect(result.readings).toHaveLength(1);
  });
});
