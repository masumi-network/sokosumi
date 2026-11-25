import {
  CMO_SOKO_BOT_VERSION_ID,
  DEFAULT_SOKO_BOT_VERSION_ID,
} from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock, findManyMock, jev } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  findManyMock: vi.fn(),
  // A plain function, not a spy: a spy reports the rejection the code handles.
  jev: {
    answer: (): Promise<unknown> => Promise.reject(new Error("Jev down")),
    messages: [] as unknown[],
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findUnique: findUniqueMock, findMany: findManyMock },
  },
}));
vi.mock("@/lib/soko-bot/jev", () => ({
  evaluateWithJev: (input: { state: { message: string } }) => {
    jev.messages.push(input.state.message);
    return jev.answer();
  },
}));

import { cmoReplyLanguageFor } from "./cmo-reply-language";

/** The note as `modelUserMessage` adds it after the turn's text. */
async function withCmoReplyLanguage(turnId: string, text: string) {
  const note = await cmoReplyLanguageFor(turnId);
  return note ? `${text}\n\n${note}` : text;
}

const createdAt = new Date("2026-11-18T08:40:00Z");
const cusoTurn = {
  sokoBotId: "cuso-1",
  versionId: CMO_SOKO_BOT_VERSION_ID,
  createdAt,
};

function names(language: string, probability = 0.99) {
  jev.answer = async () => ({
    answers: new Map([
      [
        "language",
        {
          type: "choice",
          choice: language,
          probabilities: { [language]: probability },
        },
      ],
    ]),
    costUsd: 0.000_02,
  });
}

describe("cmoReplyLanguageFor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jev.messages = [];
    jev.answer = () => Promise.reject(new Error("Jev down"));
    findUniqueMock.mockResolvedValue(cusoTurn);
  });

  it("ends a Cuso chat turn with the owner's message, its language and the rule", async () => {
    names("English");
    findManyMock.mockResolvedValue([
      {
        id: "turn-1",
        userMessage:
          "CONTEXT (last 2 messages in #Cuso):\n- Cuso: Die Liste ist jetzt leer.\n\nPatrick mentioned you in #Cuso:\n\nSEO test: how do we rank?",
        chatMention: {
          message: { content: 'SEO test: how do we rank for "nft"?' },
        },
      },
    ]);
    const text = await withCmoReplyLanguage("turn-1", "the prompt");
    expect(text.startsWith("the prompt\n\n[Reply language.")).toBe(true);
    expect(text).toContain(
      "Write to the owner in English: their new message is in English and ends: \"SEO test: how do we rank for 'nft'?\"",
    );
    expect(text).toContain("each report_update card are in English");
    expect(text).toContain("stay in the strategy's contentLanguage");
    expect(text).not.toContain("Die Liste");
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sokoBotId: "cuso-1",
          source: "CHAT",
          parentTurnId: null,
          chainDepth: 0,
          createdAt: { lte: createdAt },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("shows a follow-up what the owner last wrote, not to act on", async () => {
    names("German");
    findManyMock.mockResolvedValue([
      {
        id: "turn-1",
        userMessage: "Wie ranken wir bei Google?",
        chatMention: null,
      },
    ]);
    const text = await withCmoReplyLanguage(
      "turn-2",
      "Follow-up: something you were waiting for is done.",
    );
    expect(text).toContain(
      'Write to the owner in German: their latest chat message is in German and ends: "Wie ranken wir bei Google?"',
    );
    expect(text).toContain("do not act on it");
    expect(text).toContain("your reply or DONE report");
    expect(text).toContain("its language wins");
    expect(text).toContain('("Nothing to add.") stays exactly as asked');
  });

  it("reads an API turn's own last paragraph, where Core's wrappers put the owner's words", async () => {
    names("English");
    findManyMock.mockResolvedValue([
      {
        id: "turn-1",
        userMessage:
          "CONTEXT (last 2 messages in #Cuso):\n- Cuso: Guten Morgen.\n- Cuso: Der Entwurf ist fertig.\n\nRobin mentioned you in #Cuso:\n\nWhat is planned for next week?",
        chatMention: null,
      },
    ]);
    const text = await withCmoReplyLanguage("turn-1", "the prompt");
    expect(text).toContain('ends: "What is planned for next week?"');
    expect(jev.messages).toEqual(["What is planned for next week?"]);
  });

  it("names the language from the newest message long enough to tell", async () => {
    names("German");
    findManyMock.mockResolvedValue([
      { id: "turn-3", userMessage: "ok", chatMention: null },
      { id: "turn-2", userMessage: "SEO Test 2", chatMention: null },
      {
        id: "turn-1",
        userMessage: "Wie ranken wir bei Google?",
        chatMention: null,
      },
    ]);
    const text = await withCmoReplyLanguage("turn-3", "ok");
    expect(jev.messages).toEqual(["Wie ranken wir bei Google?"]);
    expect(text).toContain(
      'Write to the owner in German: their new message is in German and ends: "ok"',
    );
  });

  it("leaves the language to the quoted message when Jev is unsure or down", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "turn-1",
        userMessage: "Grüezi, chasch mer en Post mache?",
        chatMention: null,
      },
    ]);
    const unnamed =
      'Write to the owner in the language of their new message, which ends: "Grüezi, chasch mer en Post mache?"';
    expect(await withCmoReplyLanguage("turn-1", "the prompt")).toContain(
      unnamed,
    );
    names("German", 0.6);
    const unsure = await withCmoReplyLanguage("turn-1", "the prompt");
    expect(unsure).toContain(unnamed);
    expect(unsure).toContain("are in the owner's language all the same");
    names("other");
    expect(await withCmoReplyLanguage("turn-1", "the prompt")).toContain(
      unnamed,
    );
  });

  it("adds nothing before the owner has written in the chat", async () => {
    findManyMock.mockResolvedValue([]);
    expect(await withCmoReplyLanguage("turn-1", "New CMO client")).toBe(
      "New CMO client",
    );
    expect(jev.messages).toEqual([]);
  });

  it("leaves a personal Soko Bot's message as it is", async () => {
    findUniqueMock.mockResolvedValue({
      ...cusoTurn,
      versionId: DEFAULT_SOKO_BOT_VERSION_ID,
    });
    expect(await withCmoReplyLanguage("turn-1", "Wie geht's?")).toBe(
      "Wie geht's?",
    );
    findUniqueMock.mockResolvedValue({ ...cusoTurn, versionId: null });
    expect(await withCmoReplyLanguage("turn-1", "hi")).toBe("hi");
    expect(findManyMock).not.toHaveBeenCalled();
    expect(jev.messages).toEqual([]);
  });
});
