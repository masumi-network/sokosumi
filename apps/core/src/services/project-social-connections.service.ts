import {
  ComposioApiError,
  ComposioConfigError,
  getConnectedXIdentity,
  getProjectXConnectedAccount,
  initiateProjectXConnection,
  revokeProjectXConnection,
} from "@/clients/composio.client";
import { getEnv, getWebAppBaseUrl } from "@/config/env";
import { conflict, notFound } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";

const INTENT_TTL_MS = 15 * 60 * 1000;

export interface ProjectSocialConnectionSummary {
  id: string;
  provider: string;
  externalHandle: string | null;
  status: string;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
}

export interface InitiateProjectSocialConnectionInput {
  projectId: string;
  workspaceId: string;
  userId: string;
  provider: "x";
  action: "connect" | "reconnect" | "replace";
  socialConnectionId?: string;
}

export interface FinalizeProjectSocialConnectionInput {
  projectId: string;
  workspaceId: string;
  userId: string;
  connectionId: string;
}

export interface ListProjectSocialConnectionsInput {
  projectId: string;
  workspaceId: string;
}

export interface DisconnectProjectSocialConnectionInput {
  projectId: string;
  workspaceId: string;
  userId: string;
  socialConnectionId: string;
}

interface ProjectSocialConnectionRecord {
  id: string;
  projectId: string;
  provider: string;
  externalAccountId: string;
  externalHandle: string | null;
  composioConnectedAccountId: string;
  status: string;
  activeExternalAccountKey: string | null;
  connectorUserId: string;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
}

function projectConnectorUserId(userId: string): string {
  return `sokosumi:user:${userId}`;
}

function projectExecutorUserId(projectId: string): string {
  return `sokosumi:project-executor:${projectId}`;
}

function activeExternalAccountKey(
  provider: string,
  externalAccountId: string,
): string {
  return `${provider}:${externalAccountId}`;
}

function mapProjectSocialConnection(
  connection: ProjectSocialConnectionRecord,
): ProjectSocialConnectionSummary {
  return {
    id: connection.id,
    provider: connection.provider,
    externalHandle: connection.externalHandle,
    status: connection.status,
    connectedAt: connection.connectedAt,
    disconnectedAt: connection.disconnectedAt,
  };
}

function requireProjectXAuthConfigId(): string {
  const authConfigId = getEnv().COMPOSIO_X_AUTH_CONFIG_ID;
  if (!authConfigId) {
    throw new ComposioConfigError(
      "COMPOSIO_X_AUTH_CONFIG_ID is not configured for Project X connections",
    );
  }
  return authConfigId;
}

function isConnectionAction(
  action: string,
): action is "connect" | "reconnect" | "replace" {
  return action === "connect" || action === "reconnect" || action === "replace";
}

function requireInitiationTargetState(
  target: ProjectSocialConnectionRecord,
  action: "reconnect" | "replace",
): void {
  if (action === "reconnect") {
    if (target.status === "disconnected") {
      throw conflict("A disconnected connection requires a new connection");
    }
    if (target.status !== "reauthorization_required") {
      throw conflict(
        "Only a connection that requires reauthorization can reconnect",
      );
    }
    return;
  }

  if (target.status === "disconnected") {
    throw conflict("Only a live connection can be replaced");
  }
}

function requireFinalizationTargetState(
  target: ProjectSocialConnectionRecord,
  action: "reconnect" | "replace",
): void {
  if (action === "reconnect") {
    requireInitiationTargetState(target, action);
    return;
  }

  if (target.status !== "disconnected") {
    throw conflict("The replacement target was not retired");
  }
}

interface ProjectSocialConnectionIntentClaim {
  projectId: string;
  initiatingUserId: string;
  provider: string;
  action: "connect" | "reconnect" | "replace";
  socialConnectionId: string | null;
  authConfigId: string;
  expiresAt: Date;
}

interface ProjectSocialConnectionIntentCandidate
  extends Omit<ProjectSocialConnectionIntentClaim, "action"> {
  action: string;
}

function isLiveIntent(
  intent: ProjectSocialConnectionIntentCandidate | null,
  input: FinalizeProjectSocialConnectionInput,
): intent is ProjectSocialConnectionIntentClaim {
  return Boolean(
    intent &&
      intent.projectId === input.projectId &&
      intent.initiatingUserId === input.userId &&
      intent.provider === "x" &&
      isConnectionAction(intent.action) &&
      intent.expiresAt > new Date(),
  );
}

async function requireScopedProject(input: {
  projectId: string;
  workspaceId: string;
}): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!project) {
    throw notFound("Project not found");
  }
}

async function requireTargetConnection(input: {
  projectId: string;
  socialConnectionId?: string;
}): Promise<ProjectSocialConnectionRecord> {
  if (!input.socialConnectionId) {
    throw notFound("Project social connection not found");
  }
  const connection = await prisma.projectSocialConnection.findFirst({
    where: { id: input.socialConnectionId, projectId: input.projectId },
  });
  if (!connection) {
    throw notFound("Project social connection not found");
  }
  return connection;
}

async function refreshActiveConnectionStatus(
  connection: ProjectSocialConnectionRecord,
): Promise<ProjectSocialConnectionRecord | null> {
  if (connection.status !== "active") {
    return connection;
  }

  let account;
  try {
    account = await getProjectXConnectedAccount(
      connection.composioConnectedAccountId,
    );
  } catch (error) {
    if (error instanceof ComposioApiError && error.httpStatus !== 404) {
      return connection;
    }
    if (!(error instanceof ComposioApiError)) {
      throw error;
    }
    account = null;
  }

  if (
    account?.id === connection.composioConnectedAccountId &&
    account.status === "ACTIVE"
  ) {
    return connection;
  }

  return serializableTransaction(async (tx) => {
    const current = await tx.projectSocialConnection.findUnique({
      where: { id: connection.id },
    });
    if (!current || current.status !== "active") {
      return current;
    }

    const updated = await tx.projectSocialConnection.update({
      where: { id: current.id },
      data: { status: "reauthorization_required" },
    });
    await tx.projectSocialConnectionAudit.create({
      data: {
        projectSocialConnectionId: updated.id,
        action: "reauthorization_required",
        actorId: "system",
        externalAccountId: updated.externalAccountId,
        externalHandle: updated.externalHandle,
        providerOutcome: account?.status.toLowerCase() ?? "not_found",
      },
    });
    return updated;
  }, "Project social connection changed. Please retry.");
}

export async function initiateProjectSocialConnection(
  input: InitiateProjectSocialConnectionInput,
): Promise<{ connectionId: string; redirectUrl: string }> {
  await requireScopedProject(input);
  if (input.action === "connect" && input.socialConnectionId) {
    throw conflict("A new connection cannot target an existing social account");
  }
  if (input.action !== "connect") {
    const target = await requireTargetConnection(input);
    requireInitiationTargetState(target, input.action);
  }

  const authConfigId = requireProjectXAuthConfigId();
  if (input.action === "replace") {
    const retiredConnection = await serializableTransaction(async (tx) => {
      const target = await tx.projectSocialConnection.findFirst({
        where: {
          id: input.socialConnectionId ?? "",
          projectId: input.projectId,
        },
      });
      if (!target) {
        throw notFound("Project social connection not found");
      }
      requireInitiationTargetState(target, "replace");

      await tx.projectSocialConnection.update({
        where: { id: target.id },
        data: {
          status: "disconnected",
          activeExternalAccountKey: null,
          disconnectedAt: new Date(),
        },
      });
      const audit = await tx.projectSocialConnectionAudit.create({
        data: {
          projectSocialConnectionId: target.id,
          action: "replace_retire",
          actorId: input.userId,
          externalAccountId: target.externalAccountId,
          externalHandle: target.externalHandle,
          providerOutcome: "local_disconnect",
        },
      });
      return {
        auditId: audit.id,
        connectedAccountId: target.composioConnectedAccountId,
        socialConnectionId: target.id,
      };
    }, "Project social connection changed. Please retry.");

    await revokeRetiredProjectXConnection(retiredConnection);
  }

  const connection = await initiateProjectXConnection({
    authConfigId,
    connectorUserId: projectConnectorUserId(input.userId),
    executorUserId: projectExecutorUserId(input.projectId),
    callbackUrl: `${getWebAppBaseUrl()}/composio/callback`,
  });
  await prisma.projectSocialConnectionIntent.create({
    data: {
      connectionId: connection.connectionId,
      projectId: input.projectId,
      initiatingUserId: input.userId,
      provider: input.provider,
      action: input.action,
      socialConnectionId: input.socialConnectionId ?? null,
      authConfigId,
      expiresAt: new Date(Date.now() + INTENT_TTL_MS),
    },
  });

  return connection;
}

export async function finalizeProjectSocialConnection(
  input: FinalizeProjectSocialConnectionInput,
): Promise<ProjectSocialConnectionSummary> {
  await requireScopedProject(input);
  const intent = await prisma.projectSocialConnectionIntent.findUnique({
    where: { connectionId: input.connectionId },
  });
  if (!isLiveIntent(intent, input)) {
    throw notFound("Unknown or expired connection");
  }

  const authConfigId = intent.authConfigId;
  const connectorUserId = projectConnectorUserId(input.userId);
  const account = await getProjectXConnectedAccount(input.connectionId);
  if (
    account.id !== input.connectionId ||
    account.toolkitSlug !== "twitter" ||
    account.authConfigId !== authConfigId ||
    account.connectorUserId !== connectorUserId
  ) {
    throw notFound("Unknown or expired connection");
  }
  if (account.status !== "ACTIVE") {
    throw conflict("Connection is not active");
  }

  const identity = await getConnectedXIdentity({
    connectedAccountId: input.connectionId,
    executorUserId: projectExecutorUserId(input.projectId),
  });
  const { summary, retiredConnection } = await serializableTransaction(
    async (tx) => {
      const now = new Date();
      const currentIntent = await tx.projectSocialConnectionIntent.findUnique({
        where: { connectionId: input.connectionId },
      });
      if (!isLiveIntent(currentIntent, input)) {
        throw notFound("Unknown or expired connection");
      }
      const key = activeExternalAccountKey("x", identity.id);
      let target: ProjectSocialConnectionRecord | null = null;
      if (currentIntent.action !== "connect") {
        target = await tx.projectSocialConnection.findFirst({
          where: {
            id: currentIntent.socialConnectionId ?? "",
            projectId: input.projectId,
          },
        });
        if (!target) {
          throw notFound("Project social connection not found");
        }
        requireFinalizationTargetState(target, currentIntent.action);
        if (
          currentIntent.action === "reconnect" &&
          target.externalAccountId !== identity.id
        ) {
          throw conflict("Reconnect must match the existing account");
        }
      }

      if (
        currentIntent.action === "connect" ||
        currentIntent.action === "replace"
      ) {
        const duplicate = await tx.projectSocialConnection.findFirst({
          where: {
            projectId: input.projectId,
            activeExternalAccountKey: key,
            ...(target ? { NOT: { id: target.id } } : {}),
          },
        });
        if (duplicate) {
          throw conflict("This X account is already connected to the Project");
        }
      }

      let connection: ProjectSocialConnectionRecord;
      let retiredConnection:
        | {
            auditId: string;
            connectedAccountId: string;
            socialConnectionId: string;
          }
        | undefined;
      if (currentIntent.action === "reconnect" && target) {
        if (target.composioConnectedAccountId !== input.connectionId) {
          const retirementAudit = await tx.projectSocialConnectionAudit.create({
            data: {
              projectSocialConnectionId: target.id,
              action: "reconnect_retire",
              actorId: input.userId,
              externalAccountId: target.externalAccountId,
              externalHandle: target.externalHandle,
              providerOutcome: "local_disconnect",
            },
          });
          retiredConnection = {
            auditId: retirementAudit.id,
            connectedAccountId: target.composioConnectedAccountId,
            socialConnectionId: target.id,
          };
        }
        connection = await tx.projectSocialConnection.update({
          where: { id: target.id },
          data: {
            composioConnectedAccountId: input.connectionId,
            connectorUserId,
            externalHandle: identity.handle,
            status: "active",
            activeExternalAccountKey: key,
            connectedAt: now,
            disconnectedAt: null,
          },
        });
      } else {
        connection = await tx.projectSocialConnection.create({
          data: {
            projectId: input.projectId,
            provider: "x",
            externalAccountId: identity.id,
            externalHandle: identity.handle,
            composioConnectedAccountId: input.connectionId,
            status: "active",
            activeExternalAccountKey: key,
            connectorUserId,
            connectedAt: now,
          },
        });
      }

      await tx.projectSocialConnectionAudit.create({
        data: {
          projectSocialConnectionId: connection.id,
          action: currentIntent.action,
          actorId: input.userId,
          externalAccountId: identity.id,
          externalHandle: identity.handle,
          providerOutcome: "active",
        },
      });
      await tx.projectSocialConnectionIntent.delete({
        where: { connectionId: input.connectionId },
      });
      return {
        summary: mapProjectSocialConnection(connection),
        retiredConnection,
      };
    },
    "Project social connection changed. Please retry.",
  ).catch((error) => {
    if (isPrismaUniqueViolation(error)) {
      throw conflict("This X account is already connected to the Project");
    }
    throw error;
  });

  if (retiredConnection) {
    await revokeRetiredProjectXConnection(retiredConnection);
  }

  return summary;
}

async function revokeRetiredProjectXConnection(input: {
  auditId: string;
  connectedAccountId: string;
  socialConnectionId: string;
}): Promise<"revoked" | "skipped_shared" | "failed"> {
  const stillReferenced = await prisma.projectSocialConnection.findFirst({
    where: {
      composioConnectedAccountId: input.connectedAccountId,
      status: { not: "disconnected" },
      NOT: { id: input.socialConnectionId },
    },
    select: { id: true },
  });
  if (stillReferenced) {
    await prisma.projectSocialConnectionAudit.update({
      where: { id: input.auditId },
      data: { providerOutcome: "revocation_skipped_shared" },
    });
    return "skipped_shared";
  }

  try {
    await revokeProjectXConnection({
      connectedAccountId: input.connectedAccountId,
    });
    await prisma.projectSocialConnectionAudit.update({
      where: { id: input.auditId },
      data: { providerOutcome: "revoked" },
    });
    return "revoked";
  } catch {
    await prisma.projectSocialConnectionAudit.update({
      where: { id: input.auditId },
      data: { providerOutcome: "revocation_failed" },
    });
    return "failed";
  }
}

export async function listProjectSocialConnections(
  input: ListProjectSocialConnectionsInput,
): Promise<ProjectSocialConnectionSummary[]> {
  await requireScopedProject(input);
  const connections = await prisma.projectSocialConnection.findMany({
    where: {
      projectId: input.projectId,
      status: { not: "disconnected" },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const refreshedConnections = await Promise.all(
    connections.map(refreshActiveConnectionStatus),
  );
  return refreshedConnections
    .filter(
      (connection): connection is ProjectSocialConnectionRecord =>
        connection !== null && connection.status !== "disconnected",
    )
    .map(mapProjectSocialConnection);
}

export async function disconnectProjectSocialConnection(
  input: DisconnectProjectSocialConnectionInput,
): Promise<{
  connection: ProjectSocialConnectionSummary;
  providerRevocation: "revoked" | "skipped_shared" | "failed" | "not_required";
}> {
  await requireScopedProject(input);
  const existing = await requireTargetConnection({
    projectId: input.projectId,
    socialConnectionId: input.socialConnectionId,
  });
  if (existing.status === "disconnected") {
    return {
      connection: mapProjectSocialConnection(existing),
      providerRevocation: "not_required",
    };
  }

  const now = new Date();
  const { auditId, connection } = await serializableTransaction(async (tx) => {
    const disconnectedConnection = await tx.projectSocialConnection.update({
      where: { id: existing.id },
      data: {
        status: "disconnected",
        activeExternalAccountKey: null,
        disconnectedAt: now,
      },
    });
    const audit = await tx.projectSocialConnectionAudit.create({
      data: {
        projectSocialConnectionId: existing.id,
        action: "disconnect",
        actorId: input.userId,
        externalAccountId: existing.externalAccountId,
        externalHandle: existing.externalHandle,
        providerOutcome: "local_disconnect",
      },
    });
    return { auditId: audit.id, connection: disconnectedConnection };
  }, "Project social connection changed. Please retry.");

  const providerRevocation = await revokeRetiredProjectXConnection({
    auditId,
    connectedAccountId: existing.composioConnectedAccountId,
    socialConnectionId: existing.id,
  });
  return {
    connection: mapProjectSocialConnection(connection),
    providerRevocation,
  };
}
