import { describe, expect, it } from "vitest";
import {
  CMO_SEO_PLAIN_SKILL,
  CMO_SEO_REPORTS_SKILL,
  cmoReportsSeo,
} from "../versions/cmo-v12-skills.js";
import {
  CMO_MONTH_POINTS_SKILL,
  CMO_SHORTS_WRITING_GUIDE,
  CMO_SITE_PAGES_SKILL,
  CMO_V20_STRATEGY_SKILL,
  cmoMarksPoints,
  cmoRevisedWritingSkills,
  cmoTurnSkills,
} from "../versions/cmo-v20-skills.js";
import {
  composeSystemPrompt,
  getSokoBotSkill,
  getSokoBotVersion,
} from "../versions/index.js";
import { WRITING_SKILLS, writingSkillsBrief } from "../writing-skills/index.js";

describe("cmo-v20", () => {
  const v15 = getSokoBotVersion("cmo-v15");
  const v20 = getSokoBotVersion("cmo-v20");

  it("is cmo-v15 with this week's skills folded in", () => {
    expect(v20.systemPrompt).toBe(v15.systemPrompt);
    expect(v20.skills).toEqual([
      ...v15.skills.map(
        (skill) =>
          ({
            "cmo-strategy-plain-words": CMO_V20_STRATEGY_SKILL,
            [CMO_SEO_REPORTS_SKILL]: CMO_SEO_PLAIN_SKILL,
          })[skill] ?? skill,
      ),
      CMO_MONTH_POINTS_SKILL,
      CMO_SITE_PAGES_SKILL,
    ]);
    expect(cmoMarksPoints(v20.skills)).toBe(true);
    expect(cmoMarksPoints(v15.skills)).toBe(false);
    expect(cmoReportsSeo(v20.skills)).toBe(true);
  });

  it("plans every step on every network and pillars on facts", () => {
    const strategy = getSokoBotSkill(CMO_V20_STRATEGY_SKILL).content;
    expect(strategy).toContain("# Words for an owner who is not a marketer");
    expect(strategy).toContain("# Every step on every network");
    expect(strategy).not.toContain("sits at the one stage its posts serve");
    expect(strategy).toContain("# Pillars rest on facts");
  });

  // Owner, 2026-11-23: the daily shorts were one picture moving for five
  // seconds, with no voice and made-up screen text.
  it("cuts short videos from a script", () => {
    const strategy = getSokoBotSkill(CMO_V20_STRATEGY_SKILL).content;
    expect(strategy).not.toContain("five vertical seconds");
    expect(strategy).not.toContain("A five-second vertical video");
    expect(strategy).toContain("A short video costs about 15 credits");
    for (const format of ["voiceover", "site_tour", "top_three", "slideshow"])
      expect(CMO_SHORTS_WRITING_GUIDE).toContain(`  - ${format}: `);
    // A launch needs the owner's real date, which Cuso cannot check yet.
    expect(CMO_SHORTS_WRITING_GUIDE).not.toContain("launch");
  });

  it("reports on SEO in plain words and hands technical fixes to whoever builds the site", () => {
    const prompt = composeSystemPrompt(v20);
    expect(prompt).toContain("## Plain words for search");
    expect(prompt).toContain('"For whoever builds your site"');
    expect(composeSystemPrompt(v15)).not.toContain("## Plain words for search");
  });

  it("writes LinkedIn by its own skill and keeps every other network's", () => {
    const revised = cmoRevisedWritingSkills(v20.skills, WRITING_SKILLS);
    expect(revised.map((skill) => skill.id)).toEqual(["linkedin"]);
    expect(revised[0]!.audience).toBeTruthy();
    const brief = writingSkillsBrief(["linkedin", "x"], revised);
    expect(brief).toContain("Never cite the business's own site");
    expect(brief).toContain('<skill id="x">');
    expect(cmoRevisedWritingSkills(v15.skills, WRITING_SKILLS)).toEqual([]);
  });

  it("leaves the strategy and Brand Brain skills out of a production run only", () => {
    const run = "cmo:production:bot:1:1:0";
    expect(cmoTurnSkills(v20.skills, run)).not.toContain(
      "cmo-brand-brain-groups",
    );
    expect(cmoTurnSkills(v20.skills, "chat:1")).toEqual(v20.skills);
    expect(cmoTurnSkills(v15.skills, run)).toEqual(v15.skills);
    const full = composeSystemPrompt(v20);
    const production = composeSystemPrompt(v20, undefined, {
      clientTurnId: run,
    });
    expect(full.length - production.length).toBeGreaterThan(60_000);
  });
});
