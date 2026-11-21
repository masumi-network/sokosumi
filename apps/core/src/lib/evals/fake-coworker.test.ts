import { streamText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const metadata = { current: null as unknown };

vi.mock("@/lib/db/prisma", () => {
  const coworker = {
    findUnique: vi.fn(async () => ({ metadata: metadata.current })),
    update: vi.fn(async ({ data }: { data: { metadata: unknown } }) => {
      metadata.current = data.metadata;
      return {};
    }),
  };
  const tx = { coworker, $executeRaw: vi.fn(async () => 1) };
  return {
    default: {
      coworker,
      $transaction: async (run: (client: typeof tx) => unknown) => run(tx),
    },
  };
});

import {
  EVAL_COWORKER,
  isEvalCoworkerBaseUrl,
  scriptedReplyModel,
  setEvalCoworkerScript,
  takeEvalCoworkerReply,
} from "./fake-coworker";

describe("eval Coworker", () => {
  beforeEach(() => {
    metadata.current = null;
  });

  it("answers each question with the next scripted reply, then stays silent", async () => {
    await setEvalCoworkerScript("mira", ["First answer.", null, "Third."]);
    expect(await takeEvalCoworkerReply("mira")).toBe("First answer.");
    expect(await takeEvalCoworkerReply("mira")).toBeNull();
    expect(await takeEvalCoworkerReply("mira")).toBe("Third.");
    expect(await takeEvalCoworkerReply("mira")).toBeNull();
  });

  it("has no answer without a script", async () => {
    expect(await takeEvalCoworkerReply("mira")).toBeNull();
  });

  it("streams the reply through the normal text path", async () => {
    const result = streamText({
      model: scriptedReplyModel("Langdock costs €25 per seat."),
      prompt: "ignored",
    });
    expect(await result.text).toBe("Langdock costs €25 per seat.");
  });

  it("is only her unresolvable host", () => {
    expect(isEvalCoworkerBaseUrl(EVAL_COWORKER.baseURL)).toBe(true);
    expect(isEvalCoworkerBaseUrl("https://coworker.example.com")).toBe(false);
  });
});
