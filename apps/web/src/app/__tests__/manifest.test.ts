import { describe, expect, it } from "vitest";

import manifest from "../manifest";

describe("web app manifest", () => {
  it("keeps the whole origin in PWA scope with a same-origin start URL", () => {
    const result = manifest();

    expect(result.scope).toBe("/");
    expect(result.start_url).toBe("/");
    expect(result.start_url).not.toMatch(/^https?:\/\//);
    expect(result.display).toBe("standalone");
  });
});
