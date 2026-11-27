import { describe, expect, it } from "vitest";
import { SOKO_BOT_CAPABILITIES } from "../policy.js";
import {
  applyVersionCapabilities,
  composeSystemPrompt,
  getSokoBotSkill,
  getSokoBotVersion,
  versionShowsResultCards,
} from "../versions/index.js";
import { SKILL_INDEX } from "../versions/skill-index.js";
import { WRITING_SKILLS } from "../writing-skills/index.js";

const v37 = getSokoBotVersion("v37");
const v39 = getSokoBotVersion("v39");

describe("v39", () => {
  it("is v37 with skills on demand, the small context and the playbooks", () => {
    expect(v39.skillsOnDemand).toBe(true);
    expect(v39.skills).toEqual(
      expect.arrayContaining([
        "inbox-calendar-x",
        "context-on-demand",
        "playbooks",
        "social-posting-account",
      ]),
    );
    expect(v39.skills).not.toContain("social-posting-instructions");
    expect(v39.skills).toHaveLength(v37.skills.length + 2);
    // Its cards are shared with send_message, the messaging tool it holds.
    expect(v39.skills).toContain("result-cards-send-message");
    expect(v39.skills).not.toContain("result-cards");
    expect(versionShowsResultCards(v39)).toBe(true);
    const tools = applyVersionCapabilities(v39, SOKO_BOT_CAPABILITIES);
    expect(tools).toContain("send_message");
    expect(tools).not.toContain("post_chat");
    expect(getSokoBotSkill("result-cards-send-message").content).not.toMatch(
      /post_chat/,
    );
    for (const id of v39.skills) expect(SKILL_INDEX[id]?.useWhen).toBeTruthy();
  });

  it("is offered read_context and read_skill, and keeps one stable prompt", () => {
    const tools = applyVersionCapabilities(v39, SOKO_BOT_CAPABILITIES);
    expect(tools).toEqual(
      expect.arrayContaining(["read_context", "read_skill"]),
    );
    const persona = { name: "Joseph" } as never;
    expect(composeSystemPrompt(v39, persona, { clientTurnId: null })).toBe(
      composeSystemPrompt(v39, { name: "Alfred" } as never, {
        clientTurnId: "chat:2",
      }),
    );
  });

  it("lists every playbook by id, for read_skill", () => {
    const listed = getSokoBotSkill("playbooks").content;
    const playbooks = WRITING_SKILLS.filter(
      (skill) => skill.group === "playbooks",
    );
    expect(playbooks.length).toBeGreaterThanOrEqual(14);
    for (const skill of playbooks) expect(listed).toContain(`\`${skill.id}\``);
    expect(listed).not.toContain("`x-post`");
  });

  // What the bot asks and where drafts land is checked by behaviour: Core's
  // destination rule (social-destination.test.ts) and the owner journeys.
  it("keeps every social posting rule and adds one section on the destination", () => {
    const before = getSokoBotSkill(
      "social-posting-instructions",
    ).content.trim();
    const after = getSokoBotSkill("social-posting-account").content;
    expect(after.startsWith(before)).toBe(true);
    expect(after.slice(before.length).match(/^## /gm)).toHaveLength(1);
  });
});
