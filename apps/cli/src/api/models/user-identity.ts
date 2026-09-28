export interface UserIdentity {
  id: string;
  email: string;
  platformRole: string;
}

export function hasPlatformAdminRole(user: UserIdentity): boolean {
  return user.platformRole
    .split(",")
    .some((role) => role.trim().toLowerCase() === "admin");
}

function requiredIdentityField(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    /\p{Cc}/u.test(value)
  ) {
    throw new Error(`Invalid user identity response: invalid ${field}`);
  }
  return value;
}

export function parseUserIdentity(input: unknown): UserIdentity {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid user identity response: expected an object");
  }
  const value = input as Record<string, unknown>;
  return {
    id: requiredIdentityField(value.id, "id"),
    email: requiredIdentityField(value.email, "email"),
    platformRole: requiredIdentityField(value.role, "role"),
  };
}
