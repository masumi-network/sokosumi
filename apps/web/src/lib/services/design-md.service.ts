import "server-only";

import {
  memberRepository,
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import {
  buildDesignMdPreviewUrl,
  createDesignMdClient,
  type DesignMdClient,
  type DesignMdClientError,
  type DesignMdDonePayload,
  type DesignMdJobPayload,
} from "@sokosumi/masumi/tools";
import {
  buildOrganizationMetadataWithDesignMd,
  buildUserMetadataWithDesignMd,
  getOrganizationMetadata,
  getUserMetadata,
  parseOrganizationMetadata,
  parseUserMetadata,
  serializeMetadataRecord,
} from "@sokosumi/utils";
import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import type { Session } from "@/lib/auth/auth";
import {
  isAllowedDesignMdBlobUrl,
  uploadDesignMdToBlob,
} from "@/lib/blob/design-md";
import prisma from "@/lib/db/prisma";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import type { DesignMdOwnerSchemaType } from "@/lib/schemas/design-md";
import {
  createDesignMdJobToken,
  verifyDesignMdJobToken,
} from "@/lib/services/design-md-job-token";
import {
  descriptionIncludesTaskAttachmentLink,
  formatTaskAttachmentMarkdown,
} from "@/lib/utils/task-attachments";

const DESIGN_MD_ATTACHMENT_LABEL = "DESIGN.md";

type DesignMdServiceErrorCode =
  | "bad_input"
  | "external"
  | "internal"
  | "unauthorized"
  | "unconfigured";

export class DesignMdServiceError extends Error {
  constructor(
    readonly code: DesignMdServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DesignMdServiceError";
  }
}

export interface PersistedDesignMd {
  extractionId: string | null;
  previewUrl: string | null;
  url: string;
}

export interface EffectiveDesignMdAttachment {
  label: string;
  url: string;
}

export type StartDesignMdGenerationResult =
  | {
      kind: "completed";
      data: PersistedDesignMd;
    }
  | {
      jobId: string;
      jobToken: string;
      kind: "queued";
    };

interface ResolveEffectiveDesignMdInput {
  activeOrganizationId?: null | string;
  userId: string;
}

let client: DesignMdClient | null = null;

function assertDesignMdApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new DesignMdServiceError(
      "unconfigured",
      "Masumi DESIGN.md API key is not configured",
    );
  }

  return apiKey;
}

export function getDesignMdClient(): DesignMdClient {
  if (client) return client;

  const secrets = getEnvSecrets();
  client = createDesignMdClient({
    apiKey: assertDesignMdApiKey(secrets.MASUMI_DESIGN_MD_API_KEY),
    apiUrl: secrets.MASUMI_DESIGN_MD_API_URL,
  });

  return client;
}

function toExternalServiceError(
  error: DesignMdClientError,
): DesignMdServiceError {
  return new DesignMdServiceError("external", error.message);
}

function assertDonePayload(payload: DesignMdJobPayload): DesignMdDonePayload {
  if (payload.status !== "done") {
    throw new DesignMdServiceError(
      "bad_input",
      "DESIGN.md generation is not done yet",
    );
  }

  return payload;
}

function getJobTokenSecret(): string {
  return getEnvSecrets().BETTER_AUTH_SECRET;
}

function assertValidJobToken(
  session: Session,
  owner: DesignMdOwnerSchemaType,
  jobId: string,
  jobToken: string,
): void {
  const isValid = verifyDesignMdJobToken(
    getJobTokenSecret(),
    session.user.id,
    owner,
    jobId,
    jobToken,
  );

  if (!isValid) {
    throw new DesignMdServiceError(
      "unauthorized",
      "DESIGN.md job token is invalid or expired",
    );
  }
}

function createJobToken(
  session: Session,
  owner: DesignMdOwnerSchemaType,
  jobId: string,
): string {
  return createDesignMdJobToken(
    getJobTokenSecret(),
    session.user.id,
    owner,
    jobId,
  );
}

async function assertCanManageOwner(
  session: Session,
  owner: DesignMdOwnerSchemaType,
): Promise<void> {
  if (owner.type === "user") return;

  const member = await memberRepository.getMemberByUserIdAndOrganizationId(
    session.user.id,
    owner.organizationId,
    prisma,
  );

  if (!member || !isOrganizationOwnerOrAdmin(member.role)) {
    throw new DesignMdServiceError(
      "unauthorized",
      "Only organization owners and admins can manage DESIGN.md",
    );
  }
}

async function persistUserDesignMd(
  session: Session,
  designMd: { extractionId?: null | string; url?: null | string },
): Promise<PersistedDesignMd | null> {
  const user = await userRepository.getUserById(session.user.id, prisma);
  if (!user) {
    throw new DesignMdServiceError("unauthorized", "User not found");
  }

  const nextMetadata = buildUserMetadataWithDesignMd(
    parseUserMetadata(user.metadata),
    designMd,
  );
  const serializedMetadata = serializeMetadataRecord(nextMetadata);

  await userRepository.updateUserMetadata(
    session.user.id,
    serializedMetadata,
    prisma,
  );

  const persistedUrl = getUserMetadata(serializedMetadata).designMdUrl;
  if (!persistedUrl) return null;

  const extractionId = getUserMetadata(serializedMetadata).designMdExtractionId;

  return {
    extractionId,
    previewUrl: extractionId ? getDesignMdPreviewUrl(extractionId) : null,
    url: persistedUrl,
  };
}

async function persistOrganizationDesignMd(
  organizationId: string,
  designMd: { extractionId?: null | string; url?: null | string },
): Promise<PersistedDesignMd | null> {
  const organization =
    await organizationRepository.getOrganizationWithRelationsById(
      organizationId,
      prisma,
    );

  if (!organization) {
    throw new DesignMdServiceError("bad_input", "Organization not found");
  }

  const nextMetadata = buildOrganizationMetadataWithDesignMd(
    parseOrganizationMetadata(organization.metadata),
    designMd,
  );
  const serializedMetadata = serializeMetadataRecord(nextMetadata);

  await organizationRepository.updateOrganizationById(
    organizationId,
    {
      metadata: serializedMetadata,
    },
    prisma,
  );

  const persistedMetadata = getOrganizationMetadata(serializedMetadata);
  if (!persistedMetadata.designMdUrl) return null;

  return {
    extractionId: persistedMetadata.designMdExtractionId,
    previewUrl: persistedMetadata.designMdExtractionId
      ? getDesignMdPreviewUrl(persistedMetadata.designMdExtractionId)
      : null,
    url: persistedMetadata.designMdUrl,
  };
}

async function persistDesignMdToProfile(
  session: Session,
  owner: DesignMdOwnerSchemaType,
  designMd: { extractionId?: null | string; url?: null | string },
): Promise<PersistedDesignMd | null> {
  await assertCanManageOwner(session, owner);

  if (owner.type === "user") {
    return persistUserDesignMd(session, designMd);
  }

  return persistOrganizationDesignMd(owner.organizationId, designMd);
}

async function persistDonePayload(
  session: Session,
  owner: DesignMdOwnerSchemaType,
  donePayload: DesignMdDonePayload,
): Promise<PersistedDesignMd> {
  const extractionId = String(donePayload.extractionId);
  const blobUrl = await uploadDesignMdToBlob({
    designMd: donePayload.designMd,
    extractionId,
  });

  if (!blobUrl) {
    throw new DesignMdServiceError(
      "internal",
      "Failed to upload generated DESIGN.md",
    );
  }

  const persisted = await persistDesignMdToProfile(session, owner, {
    extractionId,
    url: blobUrl,
  });

  if (!persisted) {
    throw new DesignMdServiceError(
      "internal",
      "Failed to persist generated DESIGN.md",
    );
  }

  return persisted;
}

export function getDesignMdPreviewUrl(extractionId: string | number): string {
  return buildDesignMdPreviewUrl(getDesignMdPreviewBaseUrl(), extractionId);
}

function getDesignMdPreviewBaseUrl(): string {
  const url = new URL(getEnvPublicConfig().NEXT_PUBLIC_MASUMI_URL);
  const isLocalHost = url.hostname === "localhost";
  const isIpv4Address = /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname);

  if (!url.hostname.startsWith("www.") && !isLocalHost && !isIpv4Address) {
    url.hostname = `www.${url.hostname}`;
  }

  return url.toString();
}

export const designMdService = (() => {
  async function startDesignMdGeneration(
    session: Session,
    owner: DesignMdOwnerSchemaType,
    url: string,
    force?: boolean,
  ): Promise<StartDesignMdGenerationResult> {
    await assertCanManageOwner(session, owner);

    const result = await getDesignMdClient().submit({ force, url });
    if (result.isErr()) throw toExternalServiceError(result.error);

    const payload = result.value;
    if (payload.status === "failed") {
      throw new DesignMdServiceError(
        "external",
        payload.error ?? payload.message ?? "DESIGN.md generation failed",
      );
    }

    if (payload.status === "done") {
      return {
        kind: "completed",
        data: await persistDonePayload(session, owner, payload),
      };
    }

    return {
      kind: "queued",
      jobId: payload.jobId,
      jobToken: createJobToken(session, owner, payload.jobId),
    };
  }

  async function pollDesignMdJob(
    session: Session,
    owner: DesignMdOwnerSchemaType,
    jobId: string,
    jobToken: string,
  ): Promise<DesignMdJobPayload> {
    assertValidJobToken(session, owner, jobId, jobToken);
    await assertCanManageOwner(session, owner);

    const result = await getDesignMdClient().pollJob(jobId);
    if (result.isErr()) throw toExternalServiceError(result.error);

    return result.value;
  }

  async function finalizeAndPersistDesignMd(
    session: Session,
    owner: DesignMdOwnerSchemaType,
    jobId: string,
    jobToken: string,
  ): Promise<PersistedDesignMd> {
    assertValidJobToken(session, owner, jobId, jobToken);
    await assertCanManageOwner(session, owner);

    const result = await getDesignMdClient().pollJob(jobId);
    if (result.isErr()) throw toExternalServiceError(result.error);

    return persistDonePayload(session, owner, assertDonePayload(result.value));
  }

  async function persistUploadedDesignMd(
    session: Session,
    owner: DesignMdOwnerSchemaType,
    url: string,
  ): Promise<PersistedDesignMd> {
    if (!isAllowedDesignMdBlobUrl(url, session.user.id)) {
      throw new DesignMdServiceError(
        "bad_input",
        "DESIGN.md upload URL must come from Sokosumi blob storage",
      );
    }

    const persisted = await persistDesignMdToProfile(session, owner, {
      extractionId: null,
      url,
    });

    if (!persisted) {
      throw new DesignMdServiceError(
        "bad_input",
        "DESIGN.md upload URL is required",
      );
    }

    return persisted;
  }

  async function removeDesignMd(
    session: Session,
    owner: DesignMdOwnerSchemaType,
  ): Promise<void> {
    await persistDesignMdToProfile(session, owner, {
      extractionId: null,
      url: null,
    });
  }

  async function resolveEffectiveDesignMd({
    activeOrganizationId,
    userId,
  }: ResolveEffectiveDesignMdInput): Promise<EffectiveDesignMdAttachment | null> {
    if (activeOrganizationId) {
      const member = await memberRepository.getMemberByUserIdAndOrganizationId(
        userId,
        activeOrganizationId,
        prisma,
      );

      if (member) {
        const organization =
          await organizationRepository.getOrganizationWithRelationsById(
            activeOrganizationId,
            prisma,
          );
        const organizationDesignMdUrl = getOrganizationMetadata(
          organization?.metadata,
        ).designMdUrl;

        if (organizationDesignMdUrl) {
          return {
            label: DESIGN_MD_ATTACHMENT_LABEL,
            url: organizationDesignMdUrl,
          };
        }
      }
    }

    const user = await userRepository.getUserById(userId, prisma);
    const userDesignMdUrl = getUserMetadata(user?.metadata).designMdUrl;

    if (!userDesignMdUrl) return null;

    return {
      label: DESIGN_MD_ATTACHMENT_LABEL,
      url: userDesignMdUrl,
    };
  }

  async function appendDesignMdToDescription(
    description: string,
    userId: string,
    activeOrganizationId?: null | string,
  ): Promise<string> {
    const designMd = await resolveEffectiveDesignMd({
      activeOrganizationId,
      userId,
    });

    if (
      !designMd ||
      descriptionIncludesTaskAttachmentLink(
        description,
        designMd.label,
        designMd.url,
      )
    ) {
      return description;
    }

    const attachment = formatTaskAttachmentMarkdown(
      designMd.label,
      designMd.url,
    );
    const trimmedDescription = description.trimStart();

    return trimmedDescription
      ? `${attachment}\n${trimmedDescription}`
      : attachment;
  }

  return {
    appendDesignMdToDescription,
    finalizeAndPersistDesignMd,
    getDesignMdPreviewUrl,
    persistUploadedDesignMd,
    pollDesignMdJob,
    removeDesignMd,
    resolveEffectiveDesignMd,
    startDesignMdGeneration,
  };
})();
