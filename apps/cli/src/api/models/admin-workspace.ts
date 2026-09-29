export interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "starter" | "standard" | "pro" | "enterprise";
  billingMode: "self_serve" | "enterprise_contract";
  seatSummary: {
    purchasedSeats: number;
    assignedCount: number;
    unusedSeats: number;
    memberCount: number;
  };
}

export interface AdminUser {
  id: string;
  email: string;
}

export interface AdminWorkspaceMember {
  id: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
  seatAssignedAt: string | null;
  user: AdminUser & { name: string };
}

export function validateAdminPathSegment(value: string, label: string): string {
  const segment = value.trim();
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    /[\p{Cc}\p{Cf}/\\%]/u.test(value) ||
    /\s/u.test(segment)
  ) {
    throw new Error(
      `${label} must be a nonempty path segment without control characters, whitespace, slashes, or percent signs`,
    );
  }
  return segment;
}

export function normalizeAdminEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) ||
    /[\p{Cc}\p{Cf}]/u.test(email)
  ) {
    throw new Error("A valid developer email is required");
  }
  return normalized;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid admin response: expected ${field} object`);
  }
  return value as Record<string, unknown>;
}

function textField(value: unknown, field: string): string {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new Error(`Invalid admin response: invalid ${field}`);
  }
  return value;
}

function idField(value: unknown, field: string): string {
  const text = textField(value, field);
  const id = validateAdminPathSegment(text, field);
  if (id !== text) throw new Error(`Invalid admin response: invalid ${field}`);
  return id;
}

function countField(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid admin response: invalid ${field}`);
  }
  return value;
}

function timestampField(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)
  ) {
    throw new Error("Invalid admin response: invalid seatAssignedAt timestamp");
  }
  return value;
}

export function parseAdminUser(input: unknown): AdminUser {
  const user = record(input, "user");
  const email = textField(user.email, "user email");
  normalizeAdminEmail(email);
  return { id: idField(user.id, "user ID"), email };
}

export function parseAdminWorkspace(input: unknown): AdminWorkspace {
  const value = record(input, "Workspace");
  const organization = record(value.organization, "organization");
  const billingPlan = record(value.billingPlan, "billingPlan");
  const seatSummary = record(value.seatSummary, "seatSummary");
  const plan = billingPlan.plan;
  if (
    plan !== "free" &&
    plan !== "starter" &&
    plan !== "standard" &&
    plan !== "pro" &&
    plan !== "enterprise"
  ) {
    throw new Error("Invalid admin response: invalid billing plan");
  }
  const billingMode = billingPlan.mode;
  if (billingMode !== "self_serve" && billingMode !== "enterprise_contract") {
    throw new Error("Invalid admin response: invalid billing mode");
  }
  if ((billingMode === "enterprise_contract") !== (plan === "enterprise")) {
    throw new Error(
      "Invalid admin response: billing mode and plan do not match",
    );
  }
  return {
    id: idField(organization.id, "organization ID"),
    name: textField(organization.name, "organization name"),
    slug: idField(organization.slug, "organization slug"),
    plan,
    billingMode,
    seatSummary: {
      purchasedSeats: countField(seatSummary.purchasedSeats, "purchasedSeats"),
      assignedCount: countField(seatSummary.assignedCount, "assignedCount"),
      unusedSeats: countField(seatSummary.unusedSeats, "unusedSeats"),
      memberCount: countField(seatSummary.memberCount, "memberCount"),
    },
  };
}

export function parseAdminWorkspaceMember(
  input: unknown,
): AdminWorkspaceMember {
  const value = record(input, "member");
  const user = record(value.user, "member user");
  const role = value.role;
  if (role !== "owner" && role !== "admin" && role !== "member") {
    throw new Error("Invalid admin response: invalid member role");
  }
  return {
    id: idField(value.id, "member ID"),
    organizationId: idField(value.organizationId, "organization ID"),
    role,
    seatAssignedAt:
      value.seatAssignedAt === null
        ? null
        : timestampField(value.seatAssignedAt),
    user: { ...parseAdminUser(user), name: textField(user.name, "user name") },
  };
}

export function parseAdminSeatAssignment(input: unknown): {
  memberId: string;
  seatAssignedAt: string;
} {
  const value = record(input, "Seat assignment");
  return {
    memberId: idField(value.memberId, "member ID"),
    seatAssignedAt: timestampField(value.seatAssignedAt),
  };
}
