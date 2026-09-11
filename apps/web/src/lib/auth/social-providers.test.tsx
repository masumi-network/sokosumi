import { describe, expect, it } from "vitest";

import { isSocialProvider } from "./social-providers";

describe("isSocialProvider", () => {
  it("accepts only the providers the app offers", () => {
    expect(isSocialProvider("google")).toBe(true);
    expect(isSocialProvider("microsoft")).toBe(true);
    expect(isSocialProvider("credential")).toBe(false);
    expect(isSocialProvider("apple")).toBe(false);
  });
});
