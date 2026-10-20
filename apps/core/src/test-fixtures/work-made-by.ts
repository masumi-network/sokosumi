/**
 * Who made a piece of work, for tests that check a right follows the Owner
 * (ADR 0057) for work made by a person, a Coworker and a Soko Bot.
 */
export const WORK_MAKERS = ["person", "coworker", "sokoBot"] as const;

export type WorkMaker = (typeof WORK_MAKERS)[number];

export const FIXTURE_COWORKER_CREATOR_ID = "cow_creator";
export const FIXTURE_SOKO_BOT_CREATOR_ID =
  "01960001-0001-7001-8001-0000000000b0";

/**
 * The Owner and Creator columns of public work made by `maker` for `ownerId`:
 * the person who made it, or the person a Coworker or Soko Bot made it for.
 * `null` is work without an Owner (a deleted person, or a Coworker or Soko
 * Bot acting on its own).
 */
export function publicWorkMadeBy(maker: WorkMaker, ownerId: string | null) {
  return {
    ownerId,
    creatorUserId: maker === "person" ? ownerId : null,
    creatorCoworkerId:
      maker === "coworker" ? FIXTURE_COWORKER_CREATOR_ID : null,
    creatorSokoBotId: maker === "sokoBot" ? FIXTURE_SOKO_BOT_CREATOR_ID : null,
  };
}
