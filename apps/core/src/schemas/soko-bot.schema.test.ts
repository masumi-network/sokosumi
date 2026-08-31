import { describe, expect, it } from "vitest";

import { adminSokoBotActionRequestSchema } from "./soko-bot.schema";

describe("adminSokoBotActionRequestSchema", () => {
  it("requires a caller-owned operation id", () => {
    expect(() =>
      adminSokoBotActionRequestSchema.parse({
        action: "PAUSE",
        reason: "Investigate",
      }),
    ).toThrow();
    expect(
      adminSokoBotActionRequestSchema.parse({
        operationId: "support-pause-01960001",
        action: "PAUSE",
        reason: "Investigate",
      }),
    ).toMatchObject({ operationId: "support-pause-01960001" });
  });
});
