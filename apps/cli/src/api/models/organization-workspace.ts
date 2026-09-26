import { asRecord, nullableString } from "./parse-helpers.js";

export type OrganizationRole = "owner" | "admin" | "member";

export interface OrganizationWorkspace {
  organizationId: string;
  createdAt: string | null;
  name: string | null;
  slug: string | null;
  logo: string | null;
  role: OrganizationRole | null;
}

const ORGANIZATION_ROLES: readonly OrganizationRole[] = [
  "owner",
  "admin",
  "member",
];

function requiredOrganizationId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Invalid organization workspace response: missing id");
  }
  return value;
}

function organizationRole(value: unknown): OrganizationRole | null {
  return typeof value === "string" &&
    (ORGANIZATION_ROLES as readonly string[]).includes(value)
    ? (value as OrganizationRole)
    : null;
}

export function parseOrganizationWorkspace(
  input: unknown,
): OrganizationWorkspace {
  const value = asRecord(input);
  return {
    organizationId: requiredOrganizationId(value.id),
    createdAt: nullableString(value.createdAt),
    name: nullableString(value.name),
    slug: nullableString(value.slug),
    logo: nullableString(value.logo),
    role: organizationRole(value.role),
  };
}
