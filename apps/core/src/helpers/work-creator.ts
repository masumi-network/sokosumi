import {
  type CoworkerSummaryFields,
  coworkerSummaryFromLoadedRelation,
  sokoBotSummaryFromLoadedRelation,
  type UserSummaryFields,
  userSummaryFromLoadedRelation,
} from "./loaded-relation-summaries";
import {
  type ResponsibleUserColumns,
  resolveResponsibleUserId,
} from "./task-visibility";

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
export function creatorFields(creator: WorkCreator, personId: string | null) {
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

/** The Owner, person Creator and Requester relations of a row, as loaded. */
interface ResponsibleUserRelations<User> extends ResponsibleUserColumns {
  owner?: User | null;
  creatorUser?: User | null;
  requestedByUser?: User | null;
}

/**
 * The loaded relation of the person `resolveResponsibleUserId` names, or null
 * when nobody is responsible or the relation was not loaded.
 */
export function pickResponsibleUser<User>(
  work: ResponsibleUserRelations<User>,
): User | null {
  const userId = resolveResponsibleUserId(work);
  if (userId == null) return null;
  if (work.ownerId === userId) return work.owner ?? null;
  if (work.creatorUserId === userId) return work.creatorUser ?? null;
  return work.requestedByUser ?? null;
}

/**
 * The deprecated `owner` of a response: the responsible person (ADR 0056),
 * null only when nobody is responsible for the work.
 */
export function mapResponsibleUserSummary(
  context: string,
  work: ResponsibleUserRelations<UserSummaryFields>,
): UserSummaryFields | null {
  const userId = resolveResponsibleUserId(work);
  if (userId == null) return null;
  return userSummaryFromLoadedRelation(
    `${context} responsible person`,
    userId,
    pickResponsibleUser(work),
  );
}

const personWithEmailSelect = {
  select: { id: true, name: true, email: true, image: true },
} as const;

/**
 * The relations admin and developer task views need to name the responsible
 * person with an email address.
 */
export const responsibleUserWithEmailInclude = {
  owner: personWithEmailSelect,
  creatorUser: personWithEmailSelect,
  requestedByUser: personWithEmailSelect,
} as const;

interface PersonWithEmail {
  id: string;
  name: string;
  email: string;
}

/** The responsible person for an admin or developer view; null when nobody is. */
export function mapResponsibleUserWithEmail(
  work: ResponsibleUserRelations<PersonWithEmail>,
): PersonWithEmail | null {
  const user = pickResponsibleUser(work);
  return user && { id: user.id, name: user.name, email: user.email };
}
