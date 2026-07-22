import { describe, expect, it } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors";

import { validateCoworkerDisplayActionInput } from "../apply-display-action-input";

describe("validateCoworkerDisplayActionInput", () => {
  it("returns BAD_INPUT for invalid image intent and never validates patch", () => {
    const result = validateCoworkerDisplayActionInput({
      id: "cow_123",
      patchBody: { name: "Ops Agent" },
      imageIntent: "evil",
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error("Expected error result");
    }

    expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
  });

  it("returns BAD_INPUT for forged non-string display fields", () => {
    const result = validateCoworkerDisplayActionInput({
      id: "cow_123",
      patchBody: {
        name: 123,
      },
      imageIntent: "none",
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error("Expected error result");
    }

    expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
  });
});
