import { describe, expect, it } from "vitest";

import type { SokoBotLegacyMessage } from "@/lib/clients/generated/core";

import {
  legacyHistoryRange,
  normalizeLegacyRole,
  orderLegacyMessagesForDisplay,
} from "../legacy";

function message(
  overrides: Partial<SokoBotLegacyMessage> & { id: string; createdAt: Date },
): SokoBotLegacyMessage {
  return {
    role: "assistant",
    content: "hi",
    kind: null,
    stepCount: 0,
    durationMs: null,
    ...overrides,
  };
}

describe("legacy history helpers", () => {
  it("normalises free-form roles", () => {
    expect(normalizeLegacyRole("USER")).toBe("user");
    expect(normalizeLegacyRole("human")).toBe("user");
    expect(normalizeLegacyRole("system")).toBe("system");
    expect(normalizeLegacyRole("tool")).toBe("system");
    expect(normalizeLegacyRole("assistant")).toBe("assistant");
    expect(normalizeLegacyRole("weird")).toBe("assistant");
  });

  it("orders newest-first API payloads oldest-first and computes the range", () => {
    const newest = message({
      id: "b",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    const oldest = message({
      id: "a",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const ordered = orderLegacyMessagesForDisplay([newest, oldest]);
    expect(ordered.map((m) => m.id)).toEqual(["a", "b"]);
    expect(legacyHistoryRange([newest, oldest])).toEqual({
      from: oldest.createdAt,
      to: newest.createdAt,
    });
    expect(legacyHistoryRange([])).toBeNull();
  });
});
