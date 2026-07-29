import { userRepository } from "@sokosumi/database/repositories";
import {
  type MetadataRecord,
  normalizeWebsiteUrl,
  serializeMetadataRecord,
  withoutDesignMdMetadata,
  withPreservedDesignMdMetadata,
} from "@sokosumi/utils";
import { APIError } from "better-auth/api";

import prisma from "@/lib/db/prisma";
import { resolveDatabaseHookUserId } from "@/services/stripe-user-email.service";

const INVALID_WEBSITE_URL_CODE = "INVALID_WEBSITE_URL";
const INVALID_WEBSITE_URL_MESSAGE =
  "Website URL must be a valid http(s) URL with a domain (e.g. https://acme.com).";

/**
 * Normalizes and validates `metadata.url` when present.
 * Empty / missing url is allowed. Invalid non-empty values throw BAD_REQUEST.
 */
export function withValidatedWebsiteUrl(
  metadata: MetadataRecord | null,
): MetadataRecord | null {
  if (!metadata || !Object.hasOwn(metadata, "url")) {
    return metadata;
  }

  const rawUrl = metadata.url;
  if (rawUrl === null || rawUrl === undefined) {
    const { url: _url, ...rest } = metadata;
    return Object.keys(rest).length > 0 ? rest : null;
  }

  if (typeof rawUrl !== "string") {
    throw new APIError("BAD_REQUEST", {
      code: INVALID_WEBSITE_URL_CODE,
      message: INVALID_WEBSITE_URL_MESSAGE,
    });
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    const { url: _url, ...rest } = metadata;
    return Object.keys(rest).length > 0 ? rest : null;
  }

  const websiteUrl = normalizeWebsiteUrl(trimmed);
  if (!websiteUrl) {
    throw new APIError("BAD_REQUEST", {
      code: INVALID_WEBSITE_URL_CODE,
      message: INVALID_WEBSITE_URL_MESSAGE,
    });
  }

  return {
    ...metadata,
    url: websiteUrl,
  };
}

/**
 * Better Auth org adapter stringifies object metadata; pass a record (or null).
 * Strips client-supplied DESIGN.md fields on create and validates website URL.
 */
export function sanitizeOrganizationMetadataForCreate(
  incomingMetadata: unknown,
): Record<string, unknown> | null {
  return withValidatedWebsiteUrl(withoutDesignMdMetadata(incomingMetadata));
}

/**
 * Better Auth org adapter stringifies object metadata; pass a record (or null).
 * Forces DESIGN.md fields to match the existing org row and validates website URL.
 */
export function sanitizeOrganizationMetadataForUpdate(
  incomingMetadata: unknown,
  existingMetadata: unknown,
): Record<string, unknown> | null {
  return withValidatedWebsiteUrl(
    withPreservedDesignMdMetadata(incomingMetadata, existingMetadata),
  );
}

/**
 * User.metadata is stored as a JSON string. Strips client DESIGN.md fields and
 * validates website URL.
 */
export function sanitizeUserMetadataForCreate(
  incomingMetadata: unknown,
): string | null {
  return serializeMetadataRecord(
    withValidatedWebsiteUrl(withoutDesignMdMetadata(incomingMetadata)),
  );
}

/**
 * User.metadata is stored as a JSON string. Preserves server DESIGN.md fields
 * and validates website URL.
 */
export function sanitizeUserMetadataForUpdate(
  incomingMetadata: unknown,
  existingMetadata: unknown,
): string | null {
  return serializeMetadataRecord(
    withValidatedWebsiteUrl(
      withPreservedDesignMdMetadata(incomingMetadata, existingMetadata),
    ),
  );
}

/** Strips client DESIGN.md keys from Better Auth user create payloads. */
export function applyDesignMdMetadataGuardToUserCreate(
  user: Record<string, unknown>,
): Record<string, unknown> {
  if (!Object.hasOwn(user, "metadata")) {
    return user;
  }

  return {
    ...user,
    metadata: sanitizeUserMetadataForCreate(user.metadata),
  };
}

/**
 * Forces DESIGN.md metadata fields on Better Auth user updates to match the
 * existing DB row so clients cannot plant SSRF targets via `updateUser`.
 */
export async function applyDesignMdMetadataGuardToUserUpdate(
  updateData: Record<string, unknown>,
  ctx: unknown,
): Promise<Record<string, unknown>> {
  if (!Object.hasOwn(updateData, "metadata")) {
    return updateData;
  }

  const userId = resolveDatabaseHookUserId(ctx, updateData);
  const existing = userId
    ? await userRepository.getUserById(userId, prisma)
    : null;

  return {
    ...updateData,
    metadata: sanitizeUserMetadataForUpdate(
      updateData.metadata,
      existing?.metadata ?? null,
    ),
  };
}

/** Strips client DESIGN.md keys from Better Auth organization create payloads. */
export function applyDesignMdMetadataGuardToOrganizationCreate(
  organization: Record<string, unknown>,
): Record<string, unknown> {
  if (!Object.hasOwn(organization, "metadata")) {
    return organization;
  }

  return {
    ...organization,
    metadata: sanitizeOrganizationMetadataForCreate(organization.metadata),
  };
}

/**
 * Forces DESIGN.md metadata fields on Better Auth organization updates to match
 * the existing DB row so org admins cannot plant SSRF targets via metadata.
 */
export async function applyDesignMdMetadataGuardToOrganizationUpdate(
  organization: Record<string, unknown>,
  organizationId: string,
): Promise<Record<string, unknown>> {
  if (!Object.hasOwn(organization, "metadata")) {
    return organization;
  }

  const existing = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { metadata: true },
  });

  return {
    ...organization,
    metadata: sanitizeOrganizationMetadataForUpdate(
      organization.metadata,
      existing?.metadata ?? null,
    ),
  };
}
