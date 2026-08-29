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

  it("tell the default version that delegating work costs money", () => {
    const prompt = getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID).systemPrompt;
    // v13 said "a Task assigned to an existing Coworker is not [expensive]"
    // while the runtime withheld the hire, aiming the bot's caution at the one
    // spend path it could not take and waving through the one it could.
    expect(prompt).toMatch(/assigning a Task to a Coworker/i);
    expect(prompt).toMatch(/never free/i);
    expect(prompt).not.toMatch(/assigned to an existing Coworker is not/i);
  });

  it("tell the default version to end an assistant-to-assistant exchange", () => {
    // Two bots is the one conversation with nobody in it to lose interest, so
    // silence has to be the expected reply rather than a permitted one.
    const prompt = getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID).systemPrompt;
    expect(prompt).toMatch(/another assistant addresses you/i);
    expect(prompt).toMatch(/you have no chat tools on that turn/i);
    expect(prompt).toMatch(/Never acknowledge, thank, confirm receipt/i);
    expect(prompt).toMatch(/Nothing to add\./);
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
