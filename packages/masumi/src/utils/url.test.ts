import { describe, expect, it } from "vitest";

import { safeAddPathComponent } from "./url.js";

describe("safeAddPathComponent", () => {
  it("trims surrounding slashes and appends the encoded component", () => {
    const result = safeAddPathComponent(
      new URL("https://agent.example.com/base/"),
      "///jobs/123///",
    );

    expect(result.href).toBe("https://agent.example.com/base/jobs/123");
  });

  it("returns the original URL when the path component is blank", () => {
    const input = new URL("https://agent.example.com/base");

    const result = safeAddPathComponent(input, "   ");

    expect(result.href).toBe(input.href);
    expect(result).not.toBe(input);
  });

  it("normalizes a root pathname before appending", () => {
    const result = safeAddPathComponent(
      new URL("https://agent.example.com/"),
      "/status/",
    );

    expect(result.href).toBe("https://agent.example.com/status");
  });
});
