import { CMO_SHAPED_VIDEO_TARGETS } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import { cmoSaveStrategyInputSchema } from "../cmo.js";
import {
  CMO_VIDEO_SHAPES_SKILL,
  cmoPostsVideoShapes,
} from "../versions/cmo-video-shapes-skill.js";
import {
  CMO_SOKO_BOT_VERSION_IDS,
  getSokoBotVersion,
} from "../versions/index.js";
import { SKILL_INDEX } from "../versions/skill-index.js";
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

  it("is in the skill index, so an on-demand version lists it by its use", () => {
    expect(SKILL_INDEX[CMO_VIDEO_SHAPES_SKILL]?.useWhen).toMatch(/video/);
  });

  it("keeps the shape of a video's other posts when the month writes them", () => {
    const pieces = (channel: string, format: string, id = `v1@${channel}`) =>
      cmoSaveStrategyInputSchema.safeParse({
        part: "pieces",
        strategy: {
          calendar: [
            {
              id,
              date: "2026-10-05",
              channel,
              title: "One",
              format,
              status: "draft",
            },
          ],
        },
      });
    for (const [channel, format] of [
      ["x", "video"],
      ["instagram", "feed_video"],
      ["facebook", "feed_video"],
      ["youtube", "video"],
      ["linkedin", "wide_video"],
    ] as const) {
      const saved = pieces(channel, format);
      expect(saved.error?.issues, `${channel}/${format}`).toBeUndefined();
      expect(saved.data?.strategy.calendar?.[0]).toMatchObject({
        channel,
        format,
      });
    }
    // The calendar names a copy by its Social post id: it goes to Core as
    // sent, which keeps the shape only on the post it made for it.
    expect(
      pieces("x", "video", "3f2a9c1e-6d4b-4c8e-9a71-2b5d0e8f4c13").data
        ?.strategy.calendar?.[0],
    ).toMatchObject({ channel: "x", format: "video" });
    // Only the month's pieces write a copy; a plan save leaves it to alsoOn.
    const plan = cmoSaveStrategyInputSchema.safeParse({
      part: "patch",
      strategy: {
        calendar: [
          {
            id: "v1@x",
            date: "2026-10-05",
            channel: "x",
            title: "One",
            format: "video",
            status: "draft",
          },
        ],
      },
    });
    expect(plan.success).toBe(false);
    expect(plan.error?.issues[0]?.message).toContain("alsoOn");
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
