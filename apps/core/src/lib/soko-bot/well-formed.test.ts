import { describe, expect, it } from "vitest";
import { wellFormed } from "./well-formed";

describe("wellFormed", () => {
  it("repairs half an emoji anywhere in a model request", () => {
    const repaired = wellFormed({
      prompt: [
        {
          role: "tool",
          content: [{ type: "tool-result", output: { value: "page \ud83d" } }],
        },
      ],
    });
    expect(JSON.stringify(repaired)).not.toMatch(/\\ud83d/);
    expect(repaired.prompt[0].content[0].output.value).toBe("page �");
  });

  it("keeps whole emoji, numbers and bytes as they are", () => {
    const bytes = new Uint8Array([1, 2]);
    const repaired = wellFormed({ text: "ok 😀", n: 3, file: bytes });
    expect(repaired).toEqual({ text: "ok 😀", n: 3, file: bytes });
    expect(repaired.file).toBe(bytes);
  });
});
