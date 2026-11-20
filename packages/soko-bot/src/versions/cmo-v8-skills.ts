import type { SokoBotSkill } from "./skills.js";

/** cmo-v8's strategy skill: every entry argues its own claim, and a correction reaches the whole plan. */
export const CMO_CLAIMS_STRATEGY_SKILL = "cmo-strategy-claims";
/** cmo-v8's production skill: varied picture kinds, each piece on its claim, LinkedIn openings. */
export const CMO_VARIED_PRODUCTION_SKILL = "cmo-production-varied";

function revised(
  base: SokoBotSkill,
  id: string,
  swaps: readonly (readonly [string, string])[],
): SokoBotSkill {
  const content = swaps.reduce((text, [before, after]) => {
    if (!text.includes(before))
      throw new Error(`${id}: "${before.slice(0, 60)}" is not in ${base.id}`);
    return text.replace(before, after);
  }, base.content);
  return { ...base, id, content };
}

const TITLES_RULE =
  'Every title makes its own point: two titles that say one thing in other words ("Pick a CRM by the team that uses it", "Start your CRM choice with your team") are one piece twice, so give the second its own message.';

/**
 * NMKR's month (2026-11-20) made one point in most of its posts in other
 * words each time, so word checks passed them. A claim per entry makes the
 * point checkable: Core compares the claims by meaning.
 */
const CLAIMS_RULE = `${TITLES_RULE} Every entry, in every week, also has claim: the one sentence the piece argues, in the strategy's contentLanguage ("Routing forms book the rep who owns the segment, so no lead waits for a handover"). A claim is a point a reader can agree or disagree with, never a topic ("Lead routing") or the title again. No two pieces in one week argue one claim, and no claim is argued more than three times in the month: the strategy review compares the claims by meaning and names the pieces that repeat one. A talking video's copies on its other networks (alsoOn) are one piece.`;

const PATCH_RULE =
  "A patch (an owner's no, a new pace, an ad budget, a Brand Brain fix) changes only the entries and fields it touches, with part patch.";

/**
 * A no to ballcaps once changed the goal and left caps in the funnel's
 * plays and a question; "make week one about the new café" changed two posts.
 */
const CORRECTION_RULE = `${PATCH_RULE} A correction (an owner's no, a Brand Brain fix, "that's wrong, we sell X") is true everywhere: before you save, read every place the strategy states the old reading (the idea, summary, goals, focus, offer, each pillar and its why, each funnel stage's goal and plays, each question under questions, ads.suggest, the campaigns, and each calendar entry's title, brief, why, story and claim) and change each one that rests on it. Save it in small parts so each call stays short: first part patch with the strategy fields you change, then the calendar entries you change, at most 8 entries a call, until every one is in. Leave alone what does not rest on it. Never name what the owner rejected, not even to say it is out ("not caps"): the strategy review names every field and title that still does.`;

/** `base` is cmo-v5's every-network strategy skill. */
export function claimsStrategy(base: SokoBotSkill): SokoBotSkill {
  return revised(base, CMO_CLAIMS_STRATEGY_SKILL, [
    [TITLES_RULE, CLAIMS_RULE],
    [PATCH_RULE, CORRECTION_RULE],
  ]);
}

const KINDS_BEFORE =
  "(infographics for data and how-to, posters for events and announcements, ads and labels for products and offers)";
/**
 * 56 of NMKR's 69 styled pictures (2026-11-20) took an infographic, because
 * a how-to month asked for one each time: the month read as one panel
 * diagram after another. Core keeps the rule (find_style_references and the
 * pieces save); the skill says it first.
 */
const KINDS_AFTER =
  "and give find_style_references the piece's purpose (posters for events and announcements, ads and labels for products and offers, covers, trade cards, playbills and illustrations for how-to, stories and quotes). An infographic only for a picture that shows numbers or a comparison (purpose data or comparison), and at most one picture in four of the month; neighbouring pieces on one network take different kinds. Core holds the month to both";

const CLAIM_AND_OPENING = `- Each piece argues its entry's claim (in your brief) and only that: words that argue another piece's claim are refused, so its message is its own.
- A LinkedIn post opens with a result, a number, a named customer or a decision that sounds wrong at first, in its first two lines (about 140 characters): "Acme cut no-shows by 40% with one reminder" makes someone tap "see more"; advice, a question or a definition does not. Core reads every LinkedIn opening and refuses one that is not.`;

/** `base` is cmo-v6's batched production skill. */
export function variedProduction(base: SokoBotSkill): SokoBotSkill {
  const skill = revised(base, CMO_VARIED_PRODUCTION_SKILL, [
    [KINDS_BEFORE, KINDS_AFTER],
    [
      "- Use the named proof in your brief:",
      `${CLAIM_AND_OPENING}\n- Use the named proof in your brief:`,
    ],
  ]);
  return {
    ...skill,
    description: `${base.description} Varied picture kinds, one claim per piece, LinkedIn posts that open on a result.`,
  };
}

/** `guide` is the brief Core's month writer works from (cmo-v6). */
export function variedPieceWritingGuide(guide: string): string {
  return revised(
    { id: "writer", name: "", description: "", content: guide },
    "writer-v8",
    [
      [
        "Core picks a different print for every piece from it; vary kinds and eras across the month.",
        "Core picks a different print for every piece from it; vary kinds and eras across the month.\n- purpose, with styleLook: what the picture is for, one of product, announcement, event, offer, how-to, data, comparison, quote, people, story. data or comparison only when the picture itself shows numbers or a comparison: only those take an infographic, at most one picture in four, and Core gives neighbouring pieces on one network different kinds of print.",
      ],
      [
        "- Use the named proof in your brief:",
        `${CLAIM_AND_OPENING}\n- Use the named proof in your brief:`,
      ],
    ],
  ).content;
}
