import { describe, expect, it } from "vitest";

import { safeAddPathComponent } from "./url.js";

describe("safeAddPathComponent", () => {
  it("trims surrounding slashes and appends the encoded component", () => {
    const result = safeAddPathComponent(
      new URL("https://agent.example.com/base/"),
      "///jobs/123///",
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.href).toBe("https://agent.example.com/base/jobs/123");
    }
  });

  it("returns the original URL when the path component is blank", () => {
    const input = new URL("https://agent.example.com/base");

    const result = safeAddPathComponent(input, "   ");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.href).toBe(input.href);
      expect(result.value).not.toBe(input);
    }
  });

  it("normalizes a root pathname before appending", () => {
    const result = safeAddPathComponent(
      new URL("https://agent.example.com/"),
      "/status/",
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.href).toBe("https://agent.example.com/status");
    }
  });

  it("returns err instead of throwing when the path cannot be encoded", () => {
    const result = safeAddPathComponent(
      new URL("https://agent.example.com/base"),
      "\uD800",
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe("Invalid URL: https://agent.example.com/base");
    }
  });
});
