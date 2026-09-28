import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildActionResponseMock, claimsActionMock, turnUpdate, turnFind } =
  vi.hoisted(() => ({
    buildActionResponseMock: vi.fn(),
    claimsActionMock: vi.fn(),
    turnUpdate: vi.fn(),
    turnFind: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotTurn: { update: turnUpdate, findUnique: turnFind } },
}));
vi.mock("./answer-claims", () => ({ claimsAction: claimsActionMock }));
vi.mock("./action-response", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./action-response")>()),
  buildActionResponse: buildActionResponseMock,
}));

import { finishTurn } from "./turn-loop";

const log = { append: vi.fn(), turnId: "turn-1" };

function finish(text: string, requiresActionProof: boolean) {
  return finishTurn({
    log: log as never,
    turnId: "turn-1",
    text,
    finishReason: "stop",
    requiresActionProof,
  });
}

function completedMessage(): unknown {
  return log.append.mock.calls
    .map(([event]) => event)
    .find((event) => event.type === "message.completed")?.data.message;
}

beforeEach(() => {
  vi.clearAllMocks();
  claimsActionMock.mockResolvedValue(false);
  buildActionResponseMock.mockImplementation(
    async (_tx, _turnId, text: string) => ({ answerText: text }),
  );
});

describe("finishTurn", () => {
  it("keeps plain prose as the bot's message on a turn that could act", async () => {
    await finish("Here is the draft for your review.", true);
    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      kind: "REPORT",
      message: "Here is the draft for your review.",
    });
  });

  it("drops a message that claims an action no receipt proves", async () => {
    claimsActionMock.mockResolvedValue(true);
    await finish("I created the task and assigned it to Hannah.", true);
    expect(buildActionResponseMock.mock.calls[0][4]).toMatchObject({
      message: null,
    });
  });

  it("keeps links to pages the turn loaded and drops the rest", async () => {
    turnFind.mockResolvedValue({
      userMessage: "When is TOKEN2049?",
      contextSnapshot: { packet: null },
      toolCalls: [
        {
          capability: "web_fetch",
          result: { sources: ["https://www.token2049.com/singapore"] },
        },
        // A fetch that failed gives no grounds, though its address is here.
        {
          capability: "web_fetch",
          result: { output: "https://blocked.example/page", sources: [] },
        },
      ],
    });
    await finish(
      "7–8 October ([site](https://www.token2049.com/singapore)), see also https://blocked.example/page",
      false,
    );
    const message = completedMessage();
    expect(message).toContain("([site](https://www.token2049.com/singapore))");
    expect(message).not.toContain("blocked.example");
    expect(message).toContain("I left out a link");
    expect(turnUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          responseContract: expect.objectContaining({ answerText: message }),
        },
      }),
    );
  });

  it("reads nothing more when the answer has no links", async () => {
    await finish("Nothing to add.", false);
    expect(turnFind).not.toHaveBeenCalled();
    expect(completedMessage()).toBe("Nothing to add.");
  });
});
