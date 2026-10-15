import {
  type CoworkerSummaryFields,
  coworkerSummaryFromLoadedRelation,
  sokoBotSummaryFromLoadedRelation,
  type UserSummaryFields,
  userSummaryFromLoadedRelation,
} from "./loaded-relation-summaries";

/** Who makes a Task, Task Schedule or Job (ADR 0056). */
export type WorkCreator =
  | { kind: "user"; userId: string }
  | { kind: "coworker"; coworkerId: string }
  | { kind: "soko_bot"; sokoBotId: string };

/**
 * Creator and Requester columns of new work made for `personId`. A Coworker
 * or Soko Bot acts for that person, who becomes the Requester; a person who
 * makes their own work is never its Requester.
 */
export function creatorFields(creator: WorkCreator, personId: string) {
  switch (creator.kind) {
    case "user":
      return {
        creatorUserId: creator.userId,
        creatorCoworkerId: null,
        creatorSokoBotId: null,
        requestedByUserId: null,
      };
    case "coworker":
      return {
        creatorUserId: null,
        creatorCoworkerId: creator.coworkerId,
        creatorSokoBotId: null,
        requestedByUserId: personId,
      };
    case "soko_bot":
      return {
        creatorUserId: null,
        creatorCoworkerId: null,
        creatorSokoBotId: creator.sokoBotId,
        requestedByUserId: personId,
      };
  }
}

/** A row loaded with `workCreatorRequesterInclude`. */
interface WorkWithCreatorRequester {
  creatorUserId?: string | null;
  creatorUser?: UserSummaryFields | null;
  creatorCoworkerId?: string | null;
  creatorCoworker?: CoworkerSummaryFields | null;
  creatorSokoBotId?: string | null;
  creatorSokoBot?: Parameters<typeof sokoBotSummaryFromLoadedRelation>[2];
  requestedByUserId?: string | null;
  requestedByUser?: UserSummaryFields | null;
}

/** The `creator` of a response; null once the person who made it is deleted. */
export function mapWorkCreator(
  context: string,
  work: WorkWithCreatorRequester,
) {
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

/** The `requester` of a response: the person a Coworker or Soko Bot acted for. */
export function mapWorkRequester(
  context: string,
  work: WorkWithCreatorRequester,
) {
  if (work.requestedByUserId == null) return null;
  return userSummaryFromLoadedRelation(
    `${context} requester`,
    work.requestedByUserId,
    work.requestedByUser ?? null,
  );
}
