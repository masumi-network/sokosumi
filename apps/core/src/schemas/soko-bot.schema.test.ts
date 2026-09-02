import { describe, expect, it } from "vitest";

import {
  adminSokoBotActionRequestSchema,
  adminSokoBotVersionMigrationRequestSchema,
} from "./soko-bot.schema";

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

  it("will not move a bot without saying where to", () => {
    expect(() =>
      adminSokoBotActionRequestSchema.parse({
        operationId: "migrate-01960001",
        action: "SET_VERSION",
        reason: "Bring onto the current prompt",
      }),
    ).toThrow(/SET_VERSION requires versionId/);
  });

  it("takes a built-in id and an authored slug alike", () => {
    for (const versionId of ["v16", "steadier-hand"]) {
      expect(
        adminSokoBotActionRequestSchema.parse({
          operationId: `migrate-${versionId}`,
          action: "SET_VERSION",
          versionId,
          reason: "Bring onto the current prompt",
        }),
      ).toMatchObject({ versionId });
    }
  });

  it("refuses a version on an action that does not move one", () => {
    // Otherwise a mistyped action would read as accepted and do something
    // else entirely to somebody's bot.
    expect(() =>
      adminSokoBotActionRequestSchema.parse({
        operationId: "support-pause-01960001",
        action: "PAUSE",
        versionId: "v16",
        reason: "Investigate",
      }),
    ).toThrow(/versionId is only valid for SET_VERSION/);
  });
});

describe("adminSokoBotVersionMigrationRequestSchema", () => {
  it("treats an absent source version as the whole fleet", () => {
    const parsed = adminSokoBotVersionMigrationRequestSchema.parse({
      operationId: "fleet-v16-2026-09-02",
      toVersionId: "v16",
      reason: "Fleet is two versions behind",
    });
    expect(parsed.toVersionId).toBe("v16");
    // Absent, not empty: the service reads this as "no filter" and moves every
    // live bot, so an empty string here would silently match nothing.
    expect(parsed.fromVersionId).toBeUndefined();
  });

  it("keeps the reason mandatory, the same as a single-bot action", () => {
    expect(() =>
      adminSokoBotVersionMigrationRequestSchema.parse({
        operationId: "fleet-v16-2026-09-02",
        toVersionId: "v16",
      }),
    ).toThrow();
  });
});
