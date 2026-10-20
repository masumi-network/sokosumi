import {
  type CoworkerSummaryFields,
  coworkerSummaryFromLoadedRelation,
  sokoBotSummaryFromLoadedRelation,
  type UserSummaryFields,
  userSummaryFromLoadedRelation,
} from "./loaded-relation-summaries";
/** Who makes a Task, Task Schedule or Job (ADR 0057). */
export type WorkCreator =
  | { kind: "user"; userId: string }
  | { kind: "coworker"; coworkerId: string }
  | { kind: "soko_bot"; sokoBotId: string };

/** The Creator columns of new work. Exactly one is set. */
export function creatorFields(creator: WorkCreator) {
  return {
    creatorUserId: creator.kind === "user" ? creator.userId : null,
    creatorCoworkerId: creator.kind === "coworker" ? creator.coworkerId : null,
    creatorSokoBotId: creator.kind === "soko_bot" ? creator.sokoBotId : null,
  };
}

/** A row loaded with `workCreatorInclude`. */
interface WorkWithCreator {
  creatorUserId?: string | null;
  creatorUser?: UserSummaryFields | null;
  creatorCoworkerId?: string | null;
  creatorCoworker?: CoworkerSummaryFields | null;
  creatorSokoBotId?: string | null;
  creatorSokoBot?: Parameters<typeof sokoBotSummaryFromLoadedRelation>[2];
}

/** The `creator` of a response; null once the person who made it is deleted. */
export function mapWorkCreator(context: string, work: WorkWithCreator) {
  if (work.creatorUserId != null) {
    return {
      type: "user" as const,
      id: work.creatorUserId,
      user: userSummaryFromLoadedRelation(
        `${context} creator`,
        work.creatorUserId,
        work.creatorUser ?? null,
      ),
    };
  }

  if (work.creatorCoworkerId != null) {
    const coworker = coworkerSummaryFromLoadedRelation(
      `${context} creator`,
      work.creatorCoworkerId,
      work.creatorCoworker ?? null,
    );
    if (coworker == null) {
      throw new Error(`${context}: creator coworker summary missing`);
    }
    return {
      type: "coworker" as const,
      id: work.creatorCoworkerId,
      coworker,
    };
  }

  if (work.creatorSokoBotId != null) {
    const sokoBot = sokoBotSummaryFromLoadedRelation(
      `${context} creator`,
      work.creatorSokoBotId,
      work.creatorSokoBot ?? null,
    );
    if (sokoBot == null) {
      throw new Error(`${context}: creator sokoBot summary missing`);
    }
    return {
      type: "sokoBot" as const,
      id: work.creatorSokoBotId,
      sokoBot,
    };
  }

  return null;
}

/**
 * The `owner` of a response: the person who answers for the work, or null
 * when it has none (ADR 0057).
 */
export function mapOwnerSummary(
  context: string,
  work: { ownerId: string | null; owner?: UserSummaryFields | null },
): UserSummaryFields | null {
  if (work.ownerId === null) return null;
  return userSummaryFromLoadedRelation(
    `${context} owner`,
    work.ownerId,
    work.owner ?? null,
  );
}
