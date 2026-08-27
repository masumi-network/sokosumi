import { describe, expect, it } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors";

import { sanitizeCoworkerDisplayPatchBody } from "./sanitize-display-patch";

describe("sanitizeCoworkerDisplayPatchBody", () => {
  it("omits locked config fields from sanitized output", () => {
    const patchBody = {
      name: "Ops Agent",
      caption: "  Partner  ",
      description: "   ",
      image: "https://evil.example/logo.png",
      baseURL: "https://evil.example/base",
      url: "https://evil.example/url",
      capabilities: ["chat", "tasks"],
      priority: 99,
      metadata: { channels: "evil" },
    };

    const result = sanitizeCoworkerDisplayPatchBody(patchBody);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw new Error("Expected success result");
    }

    expect(result.value).toEqual({
      name: "Ops Agent",
      caption: "Partner",
      description: null,
    });
    expect(result.value).not.toHaveProperty("image");
    expect(result.value).not.toHaveProperty("baseURL");
    expect(result.value).not.toHaveProperty("url");
    expect(result.value).not.toHaveProperty("capabilities");
    expect(result.value).not.toHaveProperty("priority");
    expect(result.value).not.toHaveProperty("metadata");
  });

  it("returns BAD_INPUT for forged non-string display fields", () => {
    const result = sanitizeCoworkerDisplayPatchBody({
      name: 123,
      caption: true,
      description: { evil: true },
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error("Expected error result");
    }

    expect(result.error.code).toBe(CommonErrorCode.BAD_INPUT);
  });
});
