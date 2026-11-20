/**
 * What one talking video costs, before it is made.
 *
 * Shared for the same reason as `creditsPerVideoCents`: the studio's estimate,
 * the quote written at submit and the debit taken on delivery must be one number.
 *
 * A talking video is billed by the started second, and its length is the
 * length of the spoken script, which is known only once the voice exists. The
 * quote therefore comes from the script alone, in whole seconds at a pace
 * slower than the voices speak, so the person is never charged more than they
 * were shown.
 *
 * 1 credit = 1 cent, and there is no markup on fal's list prices.
 */

export const TALKING_VIDEO_SCRIPT_MIN_LENGTH = 20;
/**
 * About 40 seconds of speech. The presenter model writes some 1.5 MB a second,
 * and the caption step takes a video of at most 100 MB.
 */
export const TALKING_VIDEO_SCRIPT_MAX_LENGTH = 600;

/**
 * Characters spoken per second, for the quote. The stock voices measured 14 to
 * 17; a lower figure makes the quoted length the longer one.
 */
const QUOTED_CHARACTERS_PER_SECOND = 13;

/** Bracketed audio tags such as `[excited]` steer the voice and are not spoken. */
function spokenLength(script: string): number {
  return script.replace(/\[[^\]]*\]/g, "").trim().length;
}

/** The length a script is quoted at, in whole seconds. */
export function talkingVideoQuotedSeconds(script: string): number {
  return Math.max(
    3,
    Math.ceil(spokenLength(script) / QUOTED_CHARACTERS_PER_SECOND),
  );
}

export interface TalkingVideoPriceFigures {
  /** USD per started second of video, as fal bills the resolution sent. */
  perSecondUsd: number;
  /** USD per 1,000 characters of script, for the voice. */
  voicePer1000CharactersUsd: number;
  /** USD per minute of video, for the captions. */
  captionsPerMinuteUsd: number;
  /** USD per second of video, for cutting the presenter out over the site. */
  cutoutPerSecondUsd: number;
  /** USD for the B-roll clip in the hook. */
  brollUsd: number;
  /** USD for the music bed. */
  musicUsd: number;
}

export interface TalkingVideoExtras {
  /** The brand's site is shown behind the presenter. */
  siteShots?: boolean;
  /** A generated clip plays in the hook. */
  broll?: boolean;
  /** Generated music plays under the voice. */
  music?: boolean;
}

/** Credits (= cents) for one talking video of this script. */
export function creditsPerTalkingVideoCents(
  price: TalkingVideoPriceFigures,
  script: string,
  extras: TalkingVideoExtras = {},
): number {
  const seconds = talkingVideoQuotedSeconds(script);
  const usd =
    seconds * price.perSecondUsd +
    (script.length / 1000) * price.voicePer1000CharactersUsd +
    (seconds / 60) * price.captionsPerMinuteUsd +
    (extras.siteShots ? seconds * price.cutoutPerSecondUsd : 0) +
    (extras.broll ? price.brollUsd : 0) +
    (extras.music ? price.musicUsd : 0);
  return Math.ceil(usd * 100);
}

/**
 * What fal bills for a talking video, read from its billing events
 * (`/v1/models/billing-events`) on 2026-11-18: one $0.05 unit per started
 * second of a 1080p HeyGen Avatar 6 Turbo clip and no minimum. Seven clips:
 * 4.48 s was 5 units, 6.08 s 7, 9.68 s 10, 12.72 s 13, 14.16 s 15. Here, not
 * in Core, so what a bot is told a video costs comes from the same figures as
 * the charge.
 */
export const TALKING_VIDEO_PRICE_VERIFIED_AT = "2026-11-18";
export const TALKING_VIDEO_PRICE: TalkingVideoPriceFigures = {
  perSecondUsd: 0.05,
  voicePer1000CharactersUsd: 0.08,
  /** Timing the spoken words for the captions. */
  captionsPerMinuteUsd: 0.008,
  // The cut-out costs $0.008 per 30 frames, and fal billed 18 units for a
  // 14.16 s clip (354 frames at 25 a second): one and a half per 30 frames.
  cutoutPerSecondUsd: (0.008 * 18) / 14.16,
  // One five-second 720p B-roll clip: fal lists $0.05 a second and bills
  // 720p as two units a second, 10 units for a 5 s clip on 2026-11-18.
  brollUsd: 0.5,
  // One music clip: fal billed one $0.10 unit.
  musicUsd: 0.1,
};

/** The scripts bots are asked to write: 15 to 30 seconds of speech. */
export const TALKING_VIDEO_PLANNED_SCRIPT = { shortest: 150, longest: 400 };

const planned = (length: number, extras?: TalkingVideoExtras): number =>
  creditsPerTalkingVideoCents(TALKING_VIDEO_PRICE, "x".repeat(length), extras);

/**
 * What the scripts bots are asked to write cost, for the words that tell
 * them: a prompt or a tool description quotes these, never its own number.
 */
export const TALKING_VIDEO_PLANNED_CREDITS = {
  /** The shortest script, without the brand's site behind the presenter. */
  shortest: planned(TALKING_VIDEO_PLANNED_SCRIPT.shortest),
  /** The longest script, with the site. */
  longest: planned(TALKING_VIDEO_PLANNED_SCRIPT.longest, { siteShots: true }),
  perCharacter:
    planned(TALKING_VIDEO_PLANNED_SCRIPT.longest) /
    TALKING_VIDEO_PLANNED_SCRIPT.longest,
  sitePerCharacter:
    (planned(TALKING_VIDEO_PLANNED_SCRIPT.longest, { siteShots: true }) -
      planned(TALKING_VIDEO_PLANNED_SCRIPT.longest)) /
    TALKING_VIDEO_PLANNED_SCRIPT.longest,
};
