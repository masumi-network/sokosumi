import { CMO_SHAPED_VIDEO_TARGETS } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  CMO_VIDEO_SHAPES_SKILL,
  cmoPostsVideoShapes,
} from "../versions/cmo-video-shapes-skill.js";
import {
  CMO_SOKO_BOT_VERSION_IDS,
  getSokoBotVersion,
} from "../versions/index.js";
import { getSokoBotSkill } from "../versions/skills.js";

const COPY_ONLY =
  /\b(feed_video|wide_video|instagram_feed|facebook_feed|youtube_video|linkedin_wide)\b/;

describe("cmo-video-shapes", () => {
  it("is a skill a version opts into, named for its targets", () => {
    const skill = getSokoBotSkill(CMO_VIDEO_SHAPES_SKILL);
    for (const name of Object.keys(CMO_SHAPED_VIDEO_TARGETS)) {
      expect(skill.content).toContain(`- ${name}:`);
    }
    expect(cmoPostsVideoShapes([CMO_VIDEO_SHAPES_SKILL])).toBe(true);
    expect(cmoPostsVideoShapes([])).toBe(false);
  });

  it("changes no version that does not list it: none sees the copy-only formats", () => {
    for (const id of CMO_SOKO_BOT_VERSION_IDS) {
      const version = getSokoBotVersion(id);
      if (cmoPostsVideoShapes(version.skills)) continue;
      expect(version.systemPrompt).not.toMatch(COPY_ONLY);
      for (const skillId of version.skills) {
        expect(
          getSokoBotSkill(skillId).content,
          `${id} / ${skillId}`,
        ).not.toMatch(COPY_ONLY);
      }
    }
  });
});
