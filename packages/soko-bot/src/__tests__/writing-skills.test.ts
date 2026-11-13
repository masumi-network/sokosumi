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
    // The voice's facts and "only this business" are judged; its tone is the voice question.
    expect(judgedWritingRules("linkedin", "post")).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^It states no number/),
        expect.stringMatching(
          /^It names at least one thing only this business has/,
        ),
      ]),
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

  it("holds a Google ad to its own skill, not to a feed post's shape", () => {
    expect(
      writingSkillsForChannels(["google_ads"]).map((skill) => skill.id),
    ).toEqual(["brand-voice", "google-ads"]);
    expect(judgedWritingRules("google_ads", "search_ad")).toHaveLength(6);
  });

  it("asks the evaluator one ending rule per post and no bait rule", () => {
    const endings = (channel: string) =>
      judgedWritingRules(channel, "post").filter((rule) =>
        /ends with/.test(rule),
      );
    expect(endings("linkedin")).toEqual([
      "It ends with a single question, takeaway or call to action.",
    ]);
    expect(judgedWritingRules("facebook", "image").join(" ")).not.toMatch(
      /bait/,
    );
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
