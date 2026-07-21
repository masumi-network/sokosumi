export type UserSummaryFields = {
  id: string;
  name: string;
  image: string | null;
};

export type OrganizationSummaryFields = {
  id: string;
  name: string;
  slug: string;
};

export type CoworkerSummaryFields = {
  id: string;
  name: string;
  image: string | null;
  slug: string;
};

/**
 * Required user FK summaries (e.g. Task.owner, Job.owner). If `user` is missing
 * here, the query omitted `include` and mapping must not fabricate data.
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

/**
 * When `organizationId` is null, the API exposes no organization summary.
 * When it is set, the organization relation must be loaded (same as user).
 */
export function organizationSummaryFromLoadedRelation(
  context: string,
  organizationId: string | null,
  organization: OrganizationSummaryFields | null,
): OrganizationSummaryFields | null {
  if (organizationId == null) {
    return null;
  }

  if (organization == null) {
    throw new Error(
      `${context}: organization relation must be loaded for API mapping (organizationId=${organizationId}).`,
    );
  }

  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
  };
}

/**
 * When the coworker id is null, no coworker summary is exposed.
 * When it is set (e.g. Task.assigneeId), the coworker relation must be loaded.
 */
export function coworkerSummaryFromLoadedRelation(
  context: string,
  coworkerId: string | null,
  coworker: CoworkerSummaryFields | null,
): CoworkerSummaryFields | null {
  if (coworkerId == null) {
    return null;
  }

  if (coworker == null) {
    throw new Error(
      `${context}: coworker relation must be loaded for API mapping (coworkerId=${coworkerId}).`,
    );
  }

  return {
    id: coworker.id,
    name: coworker.name,
    image: coworker.image,
    slug: coworker.slug,
  };
}

interface OrchestratorSummaryFields {
  id: string;
  name: string;
  slug: string;
  image: string | null;
}

/**
 * When `orchestratorId` is null, there is no creator orchestrator summary.
 * When it is set, the orchestrator relation must be loaded.
 */
export function orchestratorSummaryFromLoadedRelation(
  context: string,
  orchestratorId: string | null,
  orchestrator: OrchestratorSummaryFields | null,
): OrchestratorSummaryFields | null {
  if (orchestratorId == null) {
    return null;
  }

  if (orchestrator == null) {
    throw new Error(
      `${context}: orchestrator relation must be loaded for API mapping (orchestratorId=${orchestratorId}).`,
    );
  }

  return {
    id: orchestrator.id,
    name: orchestrator.name,
    slug: orchestrator.slug,
    image: orchestrator.image,
  };
}
