import { describe, expect, it } from "vitest";

import {
  applyPresetCapabilities,
  DEFAULT_SOKO_BOT_PRESET_ID,
  getSokoBotPreset,
  isSokoBotPresetId,
  SOKO_BOT_PRESETS,
} from "../presets.js";

describe("presets", () => {
  it("have unique ids and a default that exists", () => {
    expect(new Set(SOKO_BOT_PRESETS.map((p) => p.id)).size).toBe(
      SOKO_BOT_PRESETS.length,
    );
    expect(isSokoBotPresetId(DEFAULT_SOKO_BOT_PRESET_ID)).toBe(true);
  });

  it("fall back to the default for unknown or missing ids", () => {
    expect(getSokoBotPreset(null).id).toBe(DEFAULT_SOKO_BOT_PRESET_ID);
    expect(getSokoBotPreset("nope").id).toBe(DEFAULT_SOKO_BOT_PRESET_ID);
    expect(getSokoBotPreset("medium-3.5").model).toBe(
      "mistral/mistral-medium-3.5",
    );
  });

  it("intersect the route ceiling with the allowlist but keep scratch tools", () => {
    const preset = {
      ...getSokoBotPreset("large-3"),
      capabilities: ["create_task"] as const,
    };
    expect(
      applyPresetCapabilities(preset, [
        "create_task",
        "hire_agent",
        "scratch_read",
      ]),
    ).toEqual(["create_task", "scratch_read"]);
    expect(
      applyPresetCapabilities(getSokoBotPreset("large-3"), ["hire_agent"]),
    ).toEqual(["hire_agent"]);
  });
});
