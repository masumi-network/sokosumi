import { describe, expect, it } from "vitest";

import {
  sanitizeCoworkerDisplayPatchBody,
  type UntrustedCoworkerDisplayPatch,
} from "../sanitize-display-patch";

interface MaliciousCoworkerDisplayPatch extends UntrustedCoworkerDisplayPatch {
  baseURL?: string;
  url?: string;
  capabilities?: string[];
  priority?: number;
  metadata?: Record<string, unknown>;
}

describe("sanitizeCoworkerDisplayPatchBody", () => {
  it("omits locked config fields from sanitized output", () => {
    const patchBody: MaliciousCoworkerDisplayPatch = {
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
});
