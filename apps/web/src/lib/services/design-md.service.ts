import "server-only";

import {
  buildDesignMdPreviewUrl,
  createDesignMdClient,
  type DesignMdClient,
  type DesignMdClientError,
  type DesignMdDonePayload,
  type DesignMdJobPayload,
} from "@sokosumi/masumi/tools";
import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import type { Session } from "@/lib/auth/auth";
import {
  isAllowedDesignMdBlobUrl,
  uploadDesignMdToBlob,
} from "@/lib/blob/design-md";
import {
  type CoreDesignMdMetadata,
  coreClient,
} from "@/lib/clients/core.client";
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

function toPersistedDesignMd(
  metadata: CoreDesignMdMetadata | null,
): PersistedDesignMd | null {
  if (!metadata?.url) return null;

  return {
    extractionId: metadata.extractionId,
    previewUrl: metadata.previewUrl,
    url: metadata.url,
  };
}

async function assertCanManageOwner(
  session: Session,
  owner: DesignMdOwnerSchemaType,
): Promise<void> {
  if (owner.type === "user") return;

  const response = await coreClient.getMyMemberInOrganization(
    owner.organizationId,
  );
  const member = response?.data ?? null;

  if (!member || !isOrganizationOwnerOrAdmin(member.role)) {
    throw new DesignMdServiceError(
      "unauthorized",
      "Only organization owners and admins can manage DESIGN.md",
    );
  }
}

async function persistUserDesignMd(designMd: {
  extractionId?: null | string;
  url?: null | string;
}): Promise<PersistedDesignMd | null> {
  const response = await coreClient.patchMyDesignMd({
    extractionId: designMd.extractionId,
    url: designMd.url ?? null,
  });

  return toPersistedDesignMd(response.data);
}

async function persistOrganizationDesignMd(
  organizationId: string,
  designMd: { extractionId?: null | string; url?: null | string },
): Promise<PersistedDesignMd | null> {
  const response = await coreClient.patchOrganizationDesignMd(organizationId, {
    extractionId: designMd.extractionId,
    url: designMd.url ?? null,
  });

  return toPersistedDesignMd(response.data);
}

async function persistDesignMdToProfile(
  session: Session,
  owner: DesignMdOwnerSchemaType,
  designMd: { extractionId?: null | string; url?: null | string },
): Promise<PersistedDesignMd | null> {
  await assertCanManageOwner(session, owner);

  if (owner.type === "user") {
    return persistUserDesignMd(designMd);
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
    await assertCanManageOwner(session, owner);

    if (owner.type === "user") {
      await coreClient.deleteMyDesignMd();
      return;
    }

    await coreClient.deleteOrganizationDesignMd(owner.organizationId);
  }

  async function resolveEffectiveDesignMd({
    activeOrganizationId,
    userId: _userId,
  }: ResolveEffectiveDesignMdInput): Promise<EffectiveDesignMdAttachment | null> {
    if (activeOrganizationId) {
      const memberResponse =
        await coreClient.getMyMemberInOrganization(activeOrganizationId);
      const member = memberResponse?.data ?? null;

      if (member) {
        const organizationResponse =
          await coreClient.getOrganizationDesignMd(activeOrganizationId);
        const organizationDesignMdUrl = organizationResponse.data?.url;

        if (organizationDesignMdUrl) {
          return {
            label: DESIGN_MD_ATTACHMENT_LABEL,
            url: organizationDesignMdUrl,
          };
        }
      }
    }

    const userResponse = await coreClient.getMyDesignMd();
    const userDesignMdUrl = userResponse.data?.url;

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
