import type { CmoChannelKey } from "@sokosumi/utils";

import { AD_WRITING_SKILLS } from "./ads.js";
import { FOUNDATION_WRITING_SKILLS } from "./foundations.js";
import { LONG_FORM_WRITING_SKILLS } from "./long-form.js";
import { SOCIAL_WRITING_SKILLS } from "./social.js";
import type { WritingSkill, WritingSkillGroup } from "./types.js";

export const WRITING_SKILL_GROUPS: readonly {
  key: WritingSkillGroup;
  name: string;
}[] = [
  { key: "foundations", name: "Foundations" },
  { key: "social", name: "Social networks" },
  { key: "ads", name: "Ads" },
  { key: "long_form", name: "Email and search" },
];

/** Every writing skill, grouped in display order. */
export const WRITING_SKILLS: readonly WritingSkill[] = [
  ...FOUNDATION_WRITING_SKILLS,
  ...SOCIAL_WRITING_SKILLS,
  ...AD_WRITING_SKILLS,
  ...LONG_FORM_WRITING_SKILLS,
];

/** The skill a channel's pieces follow, apart from the foundations. */
export function writingSkillForChannel(
  channel: string,
): WritingSkill | undefined {
  return WRITING_SKILLS.find(
    (skill) =>
      skill.group !== "foundations" &&
      skill.channels.includes(channel as CmoChannelKey),
  );
}

/** Every skill a set of channels needs: the foundations they use, then each channel's own. */
export function writingSkillsForChannels(
  channels: Iterable<string>,
): WritingSkill[] {
  const wanted = new Set(channels);
  return WRITING_SKILLS.filter((skill) =>
    skill.channels.some((channel) => wanted.has(channel)),
  );
}

/** A skill as Cuso reads it: its content, then the checklist each piece is held to. */
export function renderWritingSkill(skill: WritingSkill): string {
  return [
    skill.content,
    "",
    "## Before you save",
    "",
    ...skill.checklist.map((rule) => `- ${rule.rule}`),
  ].join("\n");
}

/**
 * The rules the evaluator judges one piece by: its channel's skill and the
 * foundations, for its format. Counted rules are left to Core's code, and the
 * brand voice's tone is a question of its own; its facts and its "only this
 * business could say it" are judged here.
 */
export function judgedWritingRules(channel: string, format: string): string[] {
  return writingSkillsForChannels([channel])
    .flatMap((skill) => skill.checklist)
    .filter(
      (rule) =>
        !rule.counted &&
        !rule.voice &&
        (!rule.formats || rule.formats.includes(format)),
    )
    .map((rule) => rule.rule);
}

/**
 * The skills a set of channels needs, in full, for a run's brief: the
 * foundations, then one per channel. An evaluator holds each made piece to
 * their checklists.
 */
export function writingSkillsBrief(channels: Iterable<string>): string {
  const skills = writingSkillsForChannels(channels);
  if (skills.length === 0) return "";
  return [
    "Writing skills: read each one before you write that kind of piece, and check every piece against its 'Before you save' list. The network's skill sets the shape; the brand's voice sets the words.",
    ...skills.map(
      (skill) =>
        `\n<skill id="${skill.id}">\n${renderWritingSkill(skill)}\n</skill>`,
    ),
  ].join("\n");
}
