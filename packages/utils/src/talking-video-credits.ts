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
}

/** Credits (= cents) for one talking video of this script. */
export function creditsPerTalkingVideoCents(
  price: TalkingVideoPriceFigures,
  script: string,
): number {
  const seconds = talkingVideoQuotedSeconds(script);
  const usd =
    seconds * price.perSecondUsd +
    (script.length / 1000) * price.voicePer1000CharactersUsd +
    (seconds / 60) * price.captionsPerMinuteUsd;
  return Math.ceil(usd * 100);
}
