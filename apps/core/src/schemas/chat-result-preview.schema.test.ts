import { CHAT_RESULT_REFERENCE_KINDS } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import { chatResultAvailableSchema } from "./chat-result-preview.schema";

describe("chatResultAvailableSchema", () => {
  it("matches CHAT_RESULT_REFERENCE_KINDS from @sokosumi/soko-bot 1-to-1", () => {
    expect([...chatResultAvailableSchema.shape.kind.options].sort()).toEqual(
      [...CHAT_RESULT_REFERENCE_KINDS].sort(),
    );
  });
});
