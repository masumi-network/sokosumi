import { CMO_CHANNELS } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  judgedWritingRules,
  renderWritingSkill,
  WRITING_SKILL_GROUPS,
  WRITING_SKILLS,
  writingSkillForChannel,
  writingSkillsForChannels,
} from "../index.js";

describe("writing skills", () => {
  it("gives every CMO channel its own skill", () => {
    for (const channel of Object.keys(CMO_CHANNELS))
      expect(writingSkillForChannel(channel)?.channels).toContain(channel);
  });

  it("keeps ids unique and every group shown", () => {
    const ids = WRITING_SKILLS.map((skill) => skill.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(WRITING_SKILL_GROUPS.map((group) => group.key));
    for (const skill of WRITING_SKILLS) expect(groups).toContain(skill.group);
  });

  it("scopes format rules to their format and leaves counting to code", () => {
    const pageFix = judgedWritingRules("seo", "page_fix");
    expect(pageFix.some((rule) => rule.startsWith("Page fix:"))).toBe(true);
    expect(pageFix.some((rule) => rule.startsWith("Article:"))).toBe(false);
    expect(pageFix.join(" ")).not.toMatch(/characters/);
    expect(judgedWritingRules("seo", "article")).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Article: the first/)]),
    );
    expect(judgedWritingRules("x", "post").join(" ")).not.toMatch(/Reply/);
    expect(judgedWritingRules("x", "reply")).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Reply format/)]),
    );
    expect(judgedWritingRules("linkedin", "post").join(" ")).not.toMatch(
      /voice examples/,
    );
  });

  it("only names formats each skill's channels have", () => {
    for (const skill of WRITING_SKILLS)
      for (const rule of skill.checklist)
        for (const format of rule.formats ?? [])
          expect(
            skill.channels.some((channel) =>
              Object.hasOwn(
                CMO_CHANNELS[channel as keyof typeof CMO_CHANNELS].formats,
                format,
              ),
            ),
          ).toBe(true);
  });

  it("gives every skill a short checklist the evaluator can read", () => {
    for (const skill of WRITING_SKILLS) {
      expect(skill.checklist.length).toBeGreaterThanOrEqual(3);
      expect(skill.checklist.length).toBeLessThanOrEqual(8);
    }
  });

  it("teaches no em dash, the copy rule every post is held to", () => {
    for (const skill of WRITING_SKILLS)
      expect(renderWritingSkill(skill)).not.toContain("—");
  });

  it("hands a social channel the foundations first, then its own skill", () => {
    expect(writingSkillsForChannels(["x"]).map((skill) => skill.id)).toEqual([
      "brand-voice",
      "post-formatting",
      "hooks-and-endings",
      "x",
    ]);
  });

  it("leaves plain-text post formatting out of Markdown files", () => {
    const ids = writingSkillsForChannels(["newsletter", "seo"]).map(
      (skill) => skill.id,
    );
    expect(ids).not.toContain("post-formatting");
    expect(ids).toEqual(
      expect.arrayContaining(["brand-voice", "newsletter", "seo"]),
    );
  });

  it("ends each skill with its checklist", () => {
    const linkedin = writingSkillForChannel("linkedin");
    expect(linkedin).toBeDefined();
    const text = renderWritingSkill(linkedin!);
    expect(text).toContain("## Before you save");
    expect(text.trimEnd().endsWith(linkedin!.checklist.at(-1)!.rule)).toBe(
      true,
    );
  });
});
