export type UserSummaryFields = {
  id: string;
  name: string;
  image: string | null;
};

/**
 * Builds the API user summary from a loaded Prisma `user` relation.
 * Tasks and jobs always have a valid `userId` with a required FK; if `user` is
 * missing here, the query omitted `include` and mapping must not fabricate data.
 */
export function userSummaryFromLoadedRelation(
  context: string,
  userId: string,
  user: UserSummaryFields | null,
): UserSummaryFields {
  if (user == null) {
    throw new Error(
      `${context}: user relation must be loaded for API mapping (userId=${userId}).`,
    );
  }

  return {
    id: user.id,
    name: user.name,
    image: user.image,
  };
}
