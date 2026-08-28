import { describe, expect, it } from "vitest";

import {
  applyVersionCapabilities,
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
  isSokoBotVersionId,
  SOKO_BOT_VERSIONS,
} from "../versions/index.js";

describe("versions", () => {
  it("have unique ids, known skills, and an existing default", () => {
    expect(new Set(SOKO_BOT_VERSIONS.map((v) => v.id)).size).toBe(
      SOKO_BOT_VERSIONS.length,
    );
    expect(isSokoBotVersionId(DEFAULT_SOKO_BOT_VERSION_ID)).toBe(true);
    for (const version of SOKO_BOT_VERSIONS) {
      expect(() => composeSystemPrompt(version)).not.toThrow();
    }
  });

  it("fall back to the default for unknown ids", () => {
    expect(getSokoBotVersion(null).id).toBe(DEFAULT_SOKO_BOT_VERSION_ID);
    expect(getSokoBotVersion("nope").id).toBe(DEFAULT_SOKO_BOT_VERSION_ID);
    expect(getSokoBotVersion("v2").model).toBe("mistral/mistral-medium-3.5");
  });

  it("compose the prompt from base plus skills", () => {
    const prompt = composeSystemPrompt(getSokoBotVersion("v1"));
    expect(prompt).toContain("# Delegation policy");
    expect(prompt).toContain("# Coworker coordination");
  });

  it("intersect the route ceiling with the version allowlist", () => {
    const version = {
      ...getSokoBotVersion("v1"),
      capabilities: ["create_task"] as const,
    };
    expect(
      applyVersionCapabilities(version, [
        "create_task",
        "hire_agent",
        "read_memory",
      ]),
    ).toEqual(["create_task"]);
  });
});
