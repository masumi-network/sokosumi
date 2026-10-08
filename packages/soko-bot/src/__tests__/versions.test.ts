import { describe, expect, it } from "vitest";
import { composeSokoBotVersionNotice } from "../persona.js";
import {
  applyVersionCapabilities,
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
  SOKO_BOT_VERSIONS,
} from "../versions/index.js";

describe("versions", () => {
  it("have unique ids, known skills, and an existing default", () => {
    expect(new Set(SOKO_BOT_VERSIONS.map((v) => v.id)).size).toBe(
      SOKO_BOT_VERSIONS.length,
    );
    expect(
      SOKO_BOT_VERSIONS.some(
        (version) => version.id === DEFAULT_SOKO_BOT_VERSION_ID,
      ),
    ).toBe(true);
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

  it("tell the default version it can manage Social posts", () => {
    // The social write tools shipped without prompt coverage: a bot asked
    // "can you post this?" on a read-only turn answered that its social tools
    // were read-only, then created the post when asked directly.
    const prompt = composeSystemPrompt(
      getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID),
    );
    expect(prompt).toContain("# Social posts");
    expect(prompt).toMatch(/create_social_post/);
    expect(prompt).toMatch(
      /Reads alone do not mean the capability is read-only/,
    );
    expect(prompt).toMatch(/ask me to create the post and I will/i);
  });

  it("tell the default version what the behaviour lab kept catching", () => {
    const version = getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID);
    expect(version.model).toBe("openai/gpt-6-luna");
    // Coworker questions went back to the owner instead of being answered.
    expect(version.systemPrompt).toMatch(
      /answer it on the Task with reply_to_task/,
    );
    // Links to pages the bot never opened.
    expect(version.systemPrompt).toMatch(/Cite only pages you opened/);
    // "Start a turn with chat posting available" instead of a question.
    expect(version.systemPrompt).toMatch(/"Want me to post this\?"/);
    expect(version.systemPrompt).toMatch(/list_tasks/);
  });

  it("keep the v17 prompt frozen while v18 covers every provider", () => {
    const v17Prompt = composeSystemPrompt(getSokoBotVersion("v17"));
    expect(v17Prompt).toMatch(/X only/);
    const v18Prompt = composeSystemPrompt(getSokoBotVersion("v18"));
    expect(v18Prompt).not.toMatch(/X only/);
  });

  it("tell the default version it can publish to every provider", () => {
    const prompt = composeSystemPrompt(
      getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID),
    );
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v22");
    expect(prompt).toMatch(/Instagram/);
    expect(prompt).toMatch(/TikTok/);
    expect(prompt).not.toMatch(/X only/);
  });

  it("tell owners what a version change means for them", () => {
    const luna = composeSokoBotVersionNotice(getSokoBotVersion("v19"));
    expect(luna).toMatch(/^I've been updated to version v19\./);
    // Moving an owner onto Luna moves their data outside the EU: say so.
    expect(luna).toMatch(/outside the EU/);
    expect(luna).toMatch(/search terms may be kept/);
    expect(luna).toMatch(/v20/);
    // v20 writes in the EU, but its routing and claim checks do not run there.
    const eu = composeSokoBotVersionNotice(getSokoBotVersion("v20"));
    expect(eu).toMatch(/inside the EU/);
    expect(eu).toMatch(/outside the EU/);
    // A version without a note says what it is from its summary.
    expect(
      composeSokoBotVersionNotice({ id: "custom", summary: "A lab prompt." }),
    ).toContain("A lab prompt.");
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
