import { describe, expect, it } from "vitest";

import { CMO_RESEARCH_GROUPS } from "../cmo.js";
import { CMO_BRAND_SECTION_KEYS } from "../project-marketing.js";
import {
  CMO_SOKO_BOT_VERSION_ID,
  getSokoBotSkill,
  getSokoBotVersion,
} from "../versions/index.js";

describe("Cuso's research in groups (SOKD-167)", () => {
  it("covers every Brand Brain section exactly once", () => {
    const sections = CMO_RESEARCH_GROUPS.flatMap((group) => group.sections);
    expect([...sections].sort()).toEqual([...CMO_BRAND_SECTION_KEYS].sort());
  });

  it("ships on cmo-v2, while new hires stay on cmo-v1", () => {
    const v2 = getSokoBotVersion("cmo-v2");
    expect(v2.profile).toBe("cmo");
    expect(v2.skills).toContain("cmo-brand-brain-groups");
    expect(v2.skills).not.toContain("cmo-brand-brain");
    expect(getSokoBotVersion("cmo-v1").skills).toContain("cmo-brand-brain");
    expect(CMO_SOKO_BOT_VERSION_ID).toBe("cmo-v1");
  });

  it("briefs each group under its own heading, within the turn's 30 searches", () => {
    const skill = getSokoBotSkill("cmo-brand-brain-groups").content;
    for (const group of CMO_RESEARCH_GROUPS) {
      expect(skill).toContain(`### ${group.label}`);
    }
    const searches = [...skill.matchAll(/Up to (\d+) searches?/g)].map(
      (match) => Number(match[1]),
    );
    expect(searches).toHaveLength(CMO_RESEARCH_GROUPS.length);
    expect(searches.reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(30);
  });

  it("keeps the sections, essentials and corrections cmo-v1 has", () => {
    const grouped = getSokoBotSkill("cmo-brand-brain-groups").content;
    const serial = getSokoBotSkill("cmo-brand-brain").content;
    expect(grouped).toContain(
      serial.slice(
        serial.indexOf("## The sections"),
        serial.indexOf("## Saving"),
      ),
    );
    expect(grouped).toContain(serial.slice(serial.indexOf(" a plain summary")));
    expect(grouped).toContain("hand-over");
  });

  it("reads the business's own site page by page, never from search passages", () => {
    const skill = getSokoBotSkill("cmo-brand-brain-groups").content;
    const brief = (label: string) =>
      skill.slice(skill.indexOf(`### ${label}`)).split("\n\n")[0] ?? "";
    expect(skill).toContain(
      "the business's own site is never read from passages",
    );
    expect(brief("Website")).toContain("Start with web_fetch on the homepage");
    expect(brief("Website")).toContain('"Not public" only after');
    expect(brief("Social accounts")).toContain("its profiles field");
  });
});
