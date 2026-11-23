import { SHORT_VIDEO_FORMAT_GUIDE, SHORT_VIDEO_FORMATS } from "@sokosumi/utils";
import type { SokoBotSkill } from "./skills.js";

/** cmo-v16's strategy skill: cmo-v15's, with short videos made from a script. */
export const CMO_SHORTS_STRATEGY_SKILL = "cmo-strategy-shorts";

const OLD_VIDEO =
  "Core makes the videos for the video formats (a reel, a short, a short video): five vertical seconds, made by animating a picture of the brand's own product, screen or place, with no words in the picture. Most people watch muted, so the post's own text carries the message. Describe the moment in the brief. A video costs about 30 credits, as much as four pictures, and short video is where people watch most:";
const NEW_VIDEO =
  "Core makes the videos for the video formats (a reel, a short, a short video): 15 to 30 vertical seconds without a person on camera, cut from the brand's own pictures and its real website, with a voice (or music alone), captions, a hook line in the first seconds and the logo at the end. Each one takes one of four kinds: a story with a voice, a tour of the website, a numbered top 3 list, or a photo slideshow with a line on each picture. A short video costs about 15 credits, as much as two pictures, and short video is where people watch most:";
const OLD_RATIO = "against about 30 for a moving video";
const NEW_RATIO = "against about 15 for a short video";
const OLD_MENU = "A five-second vertical video made from a brand picture";
const NEW_MENU =
  "A 15 to 30 second vertical video with a voice or music, cut from the brand's pictures and website";

/**
 * How Core's month writer writes a short video (cmo-v16), appended to its
 * brief. One source with the studio's script writer: the format guides.
 */
export const CMO_SHORTS_WRITING_GUIDE = `## Short videos
A short video (tiktok video, instagram reel, youtube short) has no person on camera. Core cuts it from the brand's pictures and its website to a voice, so it gets these besides its visual:
- shortFormat, one of ${SHORT_VIDEO_FORMATS.join(", ")}. Vary them across the month: no two short videos in a row take the same kind, and every kind is used. site_tour only when the brand has a website.
${SHORT_VIDEO_FORMATS.map((format) => `  - ${format}: ${SHORT_VIDEO_FORMAT_GUIDE[format]}`).join("\n")}
- script: for a voiced kind, the spoken words, hook first, 150 to 400 characters, in the brand's own voice, never as a customer and never describing music, footage or cuts. For a slideshow, its lines, one per row.
- hookLine: at most six words on screen over the first seconds, saying what the viewer gets; not the hook sentence word for word. Null for a slideshow.
- visual: one scene from the buyer's world that the short opens on, a place, hands, an object, light. Never a screen, a phone or a laptop showing anything: the website is shown from its real page.
The draft is the post's caption, as for any video.`;

function swap(content: string, from: string, to: string): string {
  if (!content.includes(from))
    throw new Error(`cmo-v16's strategy no longer finds: ${from.slice(0, 60)}`);
  return content.replaceAll(from, to);
}

/** `base` is cmo-v15's plain-words strategy skill. */
export function shortsStrategy(base: SokoBotSkill): SokoBotSkill {
  return {
    ...base,
    id: CMO_SHORTS_STRATEGY_SKILL,
    content: swap(
      swap(swap(base.content, OLD_VIDEO, NEW_VIDEO), OLD_RATIO, NEW_RATIO),
      OLD_MENU,
      NEW_MENU,
    ),
  };
}
