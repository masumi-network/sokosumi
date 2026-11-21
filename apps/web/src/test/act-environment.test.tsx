import { expect, it } from "vitest";

it("enables React's act diagnostics for DOM tests", () => {
  expect(globalThis).toHaveProperty("IS_REACT_ACT_ENVIRONMENT", true);
});
