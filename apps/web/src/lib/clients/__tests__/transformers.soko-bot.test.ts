import { describe, expect, it } from "vitest";

import { getMySokoBotResponseTransformer } from "@/lib/clients/generated/core/transformers.gen";

describe("getMySokoBotResponseTransformer", () => {
  it("preserves the valid no-bot state without dereferencing null", async () => {
    const result = await getMySokoBotResponseTransformer({
      data: { sokoBot: null },
      meta: { timestamp: "2026-08-19T08:00:00.000Z" },
    });

    expect(result.data.sokoBot).toBeNull();
    expect(result.meta.timestamp).toEqual(new Date("2026-08-19T08:00:00.000Z"));
  });
});
