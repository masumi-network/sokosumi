import { asRecord, nullableString } from "./parse-helpers.js";

/** One row of GET /users/me/workspaces. Most workspace commands take `workspaceId`; organization commands take `organizationId`. */
export interface UserWorkspace {
  workspaceId: string | null;
  kind: string | null;
  name: string | null;
  organizationId: string | null;
  slug: string | null;
  role: string | null;
  preferred: boolean;
}

export function parseUserWorkspace(input: unknown): UserWorkspace {
  const value = asRecord(input);
  return {
    workspaceId: nullableString(value.id),
    kind: nullableString(value.kind),
    name: nullableString(value.name),
    organizationId: nullableString(value.organizationId),
    slug: nullableString(value.slug),
    role: nullableString(value.role),
    preferred: value.preferred === true,
  };
}
