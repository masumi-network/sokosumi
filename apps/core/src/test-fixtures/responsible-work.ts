/**
 * Who made a piece of work, for tests that check a right follows the
 * responsible person (ADR 0056) for work made by a person, a Coworker and a
 * Soko Bot.
 */
export const WORK_MAKERS = ["person", "coworker", "sokoBot"] as const;

export type WorkMaker = (typeof WORK_MAKERS)[number];

export const FIXTURE_COWORKER_CREATOR_ID = "cow_creator";
export const FIXTURE_SOKO_BOT_CREATOR_ID =
  "01960001-0001-7001-8001-0000000000b0";

/**
 * The responsibility columns of public work, which has no Owner, made by
 * `maker` with `responsibleUserId` behind it: the person who made it, or the
 * person a Coworker or Soko Bot made it for. `null` is work nobody is
 * responsible for (a deleted person, or a Coworker or Soko Bot acting on its
 * own). The Owner column is null although Prisma still types it as required.
 */
export function publicWorkMadeBy(
  maker: WorkMaker,
  responsibleUserId: string | null,
) {
  return {
    ownerId: null,
    creatorUserId: maker === "person" ? responsibleUserId : null,
    creatorCoworkerId:
      maker === "coworker" ? FIXTURE_COWORKER_CREATOR_ID : null,
    creatorSokoBotId: maker === "sokoBot" ? FIXTURE_SOKO_BOT_CREATOR_ID : null,
    requestedByUserId: maker === "person" ? null : responsibleUserId,
  };
}
