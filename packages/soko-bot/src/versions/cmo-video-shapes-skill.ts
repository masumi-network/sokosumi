import {
  CMO_CHANNELS,
  CMO_SHAPED_VIDEO_TARGETS,
  CMO_VIDEO_SHAPES_SKILL,
  cmoVideoShape,
} from "@sokosumi/utils";

import type { SokoBotSkill } from "./skills.js";

export { CMO_VIDEO_SHAPES_SKILL };

/** Whether a Cuso version may post the month's videos in other shapes. */
export function cmoPostsVideoShapes(skills: readonly string[]): boolean {
  return skills.includes(CMO_VIDEO_SHAPES_SKILL);
}

const TARGET_LINES = Object.entries(CMO_SHAPED_VIDEO_TARGETS)
  .map(([name, target]) => {
    const channel = CMO_CHANNELS[target.channel];
    const format = (
      channel.formats as Record<string, { name: string; what: string }>
    )[target.format]!;
    return `- ${name}: a ${channel.name} ${format.name.toLowerCase()} (${cmoVideoShape(target.channel, target.format)}). ${format.what}.`;
  })
  .join("\n");

/**
 * The month's talking videos and shorts posted again in the shape each
 * network shows best (X and YouTube 16:9, Instagram and Facebook feed 4:5,
 * LinkedIn on a desktop 16:9). A version lists this skill to offer them;
 * older versions never see them, so merging it changes no live Cuso.
 */
export const CMO_VIDEO_SHAPES: SokoBotSkill = {
  id: CMO_VIDEO_SHAPES_SKILL,
  name: "Video in every shape",
  description:
    "Reads before planning where a talking video or short goes out: which networks get it in 16:9 or 4:5 through alsoOn.",
  content: `# Video in every shape

A talking video or a short is made once. Core can cut it again in another shape for free, from the same voice, presenter, music and pictures. You get those cuts by naming them in the entry's alsoOn, beside the networks it already goes to:

${TARGET_LINES}

- Each name becomes its own post on that network, with its own caption written for it, carrying the same video in that shape. It is no new piece: it does not count toward the month's video cap or the review's piece count.
- Use them where the network's people watch in that shape: X and YouTube in 16:9; the Instagram and Facebook feed (beside the Reel) in 4:5; LinkedIn widescreen for a founder or explainer video people watch on a desktop. LinkedIn's own talking_video already goes out in 4:5.
- Only on networks in the strategy, and only where the account is connected or the network is a planned side channel. Never two of the same name on one entry.
- A short whose story only works upright (a website tour scrolled on a phone) stays vertical: do not add these to it.`,
};
