import { redactErrorMessage, redactSensitive } from "../../error-redaction.js";
import type { CoreHttpClient } from "../http-client.js";
import {
  type AdminUser,
  type AdminWorkspace,
  type AdminWorkspaceMember,
  normalizeAdminEmail,
  parseAdminSeatAssignment,
  parseAdminUser,
  parseAdminWorkspace,
  parseAdminWorkspaceMember,
  validateAdminPathSegment,
} from "../models/admin-workspace.js";

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(30_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function responseRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid admin response: expected response object");
  }
  return input as Record<string, unknown>;
}

function responseData(input: unknown): unknown {
  const response = responseRecord(input);
  if (!("data" in response)) {
    throw new Error("Invalid admin response: missing data");
  }
  return response.data;
}

function organizationPath(slug: string): string {
  return `/v1/admin/organizations/${encodeURIComponent(validateAdminPathSegment(slug, "Organization slug"))}`;
}

async function fetchAdminPages<T>(
  client: CoreHttpClient,
  pathname: string,
  query: URLSearchParams,
  parseItem: (value: unknown) => T,
  signal?: AbortSignal,
): Promise<T[]> {
  const boundedSignal = requestSignal(signal);
  const items: T[] = [];
  const seenCursors = new Set<string>();
  query.set("limit", "50");
  for (let page = 0; page < 100; page++) {
    boundedSignal.throwIfAborted();
    const response = await client.get<unknown>(
      `${pathname}?${query}`,
      boundedSignal,
    );
    boundedSignal.throwIfAborted();
    const data = responseData(response);
    if (!Array.isArray(data))
      throw new Error("Invalid admin response: expected data array");
    const meta = responseRecord(responseRecord(response).meta);
    const pagination = responseRecord(meta.pagination);
    const nextCursor = pagination.nextCursor;
    if (
      nextCursor !== null &&
      (typeof nextCursor !== "string" ||
        !nextCursor.trim() ||
        /[\p{Cc}\p{Cf}]/u.test(nextCursor))
    ) {
      throw new Error(
        "Invalid admin response: invalid pagination nextCursor; lookup is incomplete",
      );
    }
    items.push(...data.map(parseItem));
    if (nextCursor === null) return items;
    if (seenCursors.has(nextCursor))
      throw new Error(
        "Admin pagination repeated a cursor; lookup is incomplete",
      );
    seenCursors.add(nextCursor);
    query.set("cursor", nextCursor);
  }
  throw new Error("Admin pagination exceeded 100 pages; lookup is incomplete");
}

export async function fetchAdminWorkspace(
  client: CoreHttpClient,
  slug: string,
  signal?: AbortSignal,
): Promise<AdminWorkspace> {
  const expectedSlug = validateAdminPathSegment(slug, "Organization slug");
  const boundedSignal = requestSignal(signal);
  boundedSignal.throwIfAborted();
  const response = await client.get<unknown>(
    organizationPath(expectedSlug),
    boundedSignal,
  );
  boundedSignal.throwIfAborted();
  const workspace = parseAdminWorkspace(responseData(response));
  if (workspace.slug !== expectedSlug)
    throw new Error(
      "Invalid admin response: organization slug does not match the request",
    );
  return workspace;
}

export async function fetchAdminWorkspaceMembers(
  client: CoreHttpClient,
  slug: string,
  signal?: AbortSignal,
): Promise<AdminWorkspaceMember[]> {
  return fetchAdminPages(
    client,
    `${organizationPath(slug)}/members`,
    new URLSearchParams(),
    parseAdminWorkspaceMember,
    signal,
  );
}

export async function findAdminUserByEmail(
  client: CoreHttpClient,
  email: string,
  signal?: AbortSignal,
): Promise<AdminUser> {
  const normalizedEmail = normalizeAdminEmail(email);
  const users = await fetchAdminPages(
    client,
    "/v1/admin/users",
    new URLSearchParams({ query: normalizedEmail }),
    parseAdminUser,
    signal,
  );
  const matches = new Map(
    users
      .filter((user) => normalizeAdminEmail(user.email) === normalizedEmail)
      .map((user) => [user.id, user]),
  );
  if (matches.size > 1)
    throw new Error("More than one user has this email. No member was added.");
  const user = matches.values().next().value;
  if (!user)
    throw new Error(
      "No user with this exact email was found. The developer must sign in to Preprod first.",
    );
  return user;
}

function mutationError(error: unknown, slug: string): Error {
  const fields =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const status =
    typeof fields.status === "number" &&
    Number.isInteger(fields.status) &&
    fields.status >= 100 &&
    fields.status <= 599
      ? fields.status
      : undefined;
  const uncertain = status === undefined || status >= 500 || status < 400;
  const isCoreApiError =
    error instanceof Error &&
    error.name === "CoreApiError" &&
    status !== undefined &&
    "body" in fields;
  const reason = isCoreApiError ? error.message : redactErrorMessage(error);
  const message = `${reason}${uncertain ? ` The change may have succeeded; inspect \`sokosumi --preprod admin members WORKSPACE_SLUG\` before retrying. Organization slug: ${slug}.` : ""}`;
  const failure = new Error(message);
  if (error instanceof Error) failure.name = error.name;
  if (status !== undefined)
    Object.defineProperty(failure, "status", {
      value: status,
      enumerable: true,
    });
  if ("body" in fields)
    Object.defineProperty(failure, "body", {
      value: isCoreApiError ? fields.body : redactSensitive(fields.body),
      enumerable: true,
    });
  return failure;
}

export async function addAdminWorkspaceMember(
  client: CoreHttpClient,
  slug: string,
  organizationId: string,
  user: AdminUser,
  signal?: AbortSignal,
): Promise<AdminWorkspaceMember> {
  const path = `${organizationPath(slug)}/members`;
  const expectedOrganizationId = validateAdminPathSegment(
    organizationId,
    "Organization ID",
  );
  const expectedUser = parseAdminUser(user);
  const boundedSignal = requestSignal(signal);
  boundedSignal.throwIfAborted();
  try {
    const response = await client.post<unknown>(
      path,
      { userId: expectedUser.id, role: "member" },
      boundedSignal,
    );
    boundedSignal.throwIfAborted();
    const member = parseAdminWorkspaceMember(responseData(response));
    if (
      member.organizationId !== expectedOrganizationId ||
      member.user.id !== expectedUser.id ||
      normalizeAdminEmail(member.user.email) !==
        normalizeAdminEmail(expectedUser.email) ||
      member.role !== "member"
    ) {
      throw new Error(
        "Invalid admin response: added member does not match the request",
      );
    }
    return member;
  } catch (error) {
    throw mutationError(error, slug);
  }
}

export async function assignAdminWorkspaceSeat(
  client: CoreHttpClient,
  slug: string,
  memberId: string,
  signal?: AbortSignal,
): Promise<{ memberId: string; seatAssignedAt: string }> {
  const expectedMemberId = validateAdminPathSegment(memberId, "Member ID");
  const path = `${organizationPath(slug)}/members/${encodeURIComponent(expectedMemberId)}/seat`;
  const boundedSignal = requestSignal(signal);
  boundedSignal.throwIfAborted();
  try {
    const response = await client.put<unknown>(path, undefined, boundedSignal);
    boundedSignal.throwIfAborted();
    const assignment = parseAdminSeatAssignment(responseData(response));
    if (assignment.memberId !== expectedMemberId)
      throw new Error(
        "Invalid admin response: Seat member ID does not match the request",
      );
    return assignment;
  } catch (error) {
    throw mutationError(error, slug);
  }
}
