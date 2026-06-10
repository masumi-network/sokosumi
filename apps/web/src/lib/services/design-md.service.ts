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
import { coreClient } from "@/lib/clients/core.client";
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
  owner: DesignMdOwnerSchemaType,
): Promise<void> {
  if (owner.type === "user") return;

  const member = await coreClient.getMyMemberInOrganization(
    owner.organizationId,
  );

  if (!member || !isOrganizationOwnerOrAdmin(member.data.role)) {
    throw new DesignMdServiceError(
      "unauthorized",
      "Only organization owners and admins can manage DESIGN.md",
    );
  }
}

async function persistDesignMdToProfile(
  owner: DesignMdOwnerSchemaType,
  designMd: { extractionId?: null | string; content?: null | string },
): Promise<PersistedDesignMd | null> {
  await assertCanManageOwner(owner);

  const body = {
    content: designMd.content ?? null,
    extractionId: designMd.extractionId ?? null,
  };

  const { data } =
    owner.type === "user"
      ? await coreClient.setMyDesignMd(body)
      : await coreClient.setOrganizationDesignMd(owner.organizationId, body);

  if (!data.designMd) return null;

  const { extractionId, url } = data.designMd;

  return {
    extractionId,
    previewUrl: extractionId ? getDesignMdPreviewUrl(extractionId) : null,
    url,
  };
}

async function persistDonePayload(
  owner: DesignMdOwnerSchemaType,
  donePayload: DesignMdDonePayload,
): Promise<PersistedDesignMd> {
  const persisted = await persistDesignMdToProfile(owner, {
    extractionId: String(donePayload.extractionId),
    content: donePayload.designMd,
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
    await assertCanManageOwner(owner);

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
        data: await persistDonePayload(owner, payload),
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
    await assertCanManageOwner(owner);

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
    await assertCanManageOwner(owner);

    const result = await getDesignMdClient().pollJob(jobId);
    if (result.isErr()) throw toExternalServiceError(result.error);

    return persistDonePayload(owner, assertDonePayload(result.value));
  }

  async function persistUploadedDesignMd(
    owner: DesignMdOwnerSchemaType,
    content: string,
  ): Promise<PersistedDesignMd> {
    const persisted = await persistDesignMdToProfile(owner, {
      extractionId: null,
      content,
    });

    if (!persisted) {
      throw new DesignMdServiceError(
        "bad_input",
        "DESIGN.md content is required",
      );
    }

    return persisted;
  }

  async function removeDesignMd(owner: DesignMdOwnerSchemaType): Promise<void> {
    await persistDesignMdToProfile(owner, {
      extractionId: null,
      content: null,
    });
  }

  async function resolveEffectiveDesignMd(): Promise<EffectiveDesignMdAttachment | null> {
    const { data } = await coreClient.getWorkspaceDesignMd();

    return data.designMd;
  }

  async function appendDesignMdToDescription(
    description: string,
  ): Promise<string> {
    const designMd = await resolveEffectiveDesignMd();

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
