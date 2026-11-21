import type { Prisma } from "@sokosumi/database";
import {
  ComposioConfigError,
  deleteProjectSocialConnectionIntent,
  getComposioConnectedAccount,
  getConnectedSocialIdentity,
  initiateComposioConnection,
  revokeComposioConnectedAccount,
} from "@/clients/composio.client";
import { getZernioAccountId } from "@/clients/zernio.client";
import { getEnv, getWebAppBaseUrl } from "@/config/env";
import {
  isProjectSocialProvider,
  PROJECT_SOCIAL_PROVIDERS,
  type ProjectSocialProvider,
  requireOwnTikTokAppAllowed,
  requireSocialProviderEnabled,
  socialProviderProjectSelect,
} from "@/config/social-providers";
import { lockCalendarScope } from "@/helpers/calendar-locks";
import { composioHandoffUrl } from "@/helpers/composio-handoff";
import { conflict, integrationNotConfigured, notFound } from "@/helpers/error";
import { linkedInPersonId, linkedInPersonUrn } from "@/helpers/linkedin-person";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import {
  type ProjectSocialConnectionSummary,
  projectSocialConnectionSummary,
} from "@/helpers/project-social-connection-summary";
import type { SocialAccountPick } from "@/helpers/social-account-choice";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { emitCoreWarning } from "@/lib/evlog";
import {
  deleteSocialAccountAvatarIfOwned,
  snapshotSocialAccountAvatar,
} from "@/lib/social-account-avatar";
import { connectZernioLinkedInAccount } from "./zernio-linkedin-connection.service";
import {
  createZernioIntent,
  deleteZernioProfile,
  getZernioAuthUrl,
  getZernioProfileIdentity,
  zernioProofDigest,
} from "./zernio-tiktok-connection.service";

const INTENT_TTL_MS = 15 * 60 * 1000;

export type { ProjectSocialConnectionSummary };

export type InitiateProjectSocialConnectionInput = {
  projectId: string;
  workspaceId: string;
  userId: string;
  /**
   * Where the provider sends the owner back. Defaults to Web's popup
   * callback; a first-party app passes its own page, checked by the route.
   */
  callbackUrl?: string;
  /**
   * The caller lets the owner pick the account a sign-in connects. LinkedIn
   * then signs in through Zernio, which reaches the person's Pages.
   */
  accountChoice?: boolean;
} & (
  | {
      provider: ProjectSocialProvider;
      action: "connect";
      socialConnectionId?: never;
    }
  | {
      action: "reconnect" | "replace";
      socialConnectionId: string;
    }
);

export interface FinalizeProjectSocialConnectionInput {
  projectId: string;
  workspaceId: string;
  userId: string;
  connectionId: string;
  callbackProof?: string;
  /** Zernio's handle on a LinkedIn sign-in that waits for its account. */
  pendingDataToken?: string;
  connectToken?: string;
  /** The `SocialAccountChoice.id` the owner picked among the sign-in's accounts. */
  accountChoiceId?: string;
  /**
   * Throw `SocialAccountChoiceRequiredError` when the sign-in reaches several
   * accounts and none is picked, instead of refusing or taking the profile.
   */
  offerChoice?: boolean;
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
  displayName: string | null;
  avatarUrl: string | null;
  subscriptionType: string | null;
  composioConnectedAccountId: string;
  zernioProfileId: string | null;
  status: string;
  activeExternalAccountKey: string | null;
  connectorUserId: string;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
}

/** Composio user id that owns a connection the given user authorized. */
export function projectConnectorUserId(userId: string): string {
  return `sokosumi:user:${userId}`;
}

/** Composio user id under which a Project executes tools on its connected accounts. */
export function projectExecutorUserId(projectId: string): string {
  return `sokosumi:project-executor:${projectId}`;
}

/**
 * The executor of one connection: a test copy's link runs as the Project the
 * account was granted to (ADR 0073), every other row as its own Project.
 */
export function connectionExecutorUserId(connection: {
  projectId: string;
  executorProjectId?: string | null;
}): string {
  return projectExecutorUserId(
    connection.executorProjectId ?? connection.projectId,
  );
}

function activeExternalAccountKey(
  provider: string,
  externalAccountId: string,
): string {
  return `${provider}:${externalAccountId}`;
}

/** Keys an active row for this account may hold, including legacy LinkedIn URN rows. */
function activeExternalAccountKeys(
  provider: string,
  externalAccountId: string,
): string[] {
  if (provider !== "linkedin") {
    return [activeExternalAccountKey(provider, externalAccountId)];
  }
  return [
    activeExternalAccountKey(provider, linkedInPersonId(externalAccountId)),
    activeExternalAccountKey(provider, linkedInPersonUrn(externalAccountId)),
  ];
}

/** LinkedIn rows saved before the bare id hold the full person URN. */
function isSameExternalAccount(
  provider: string,
  stored: string,
  current: string,
): boolean {
  return provider === "linkedin"
    ? linkedInPersonId(stored) === linkedInPersonId(current)
    : stored === current;
}

function mapProjectSocialConnection(
  connection: ProjectSocialConnectionRecord,
): ProjectSocialConnectionSummary {
  const summary = projectSocialConnectionSummary(connection);
  if (!summary) throw notFound("Unsupported social connection provider");
  return summary;
}

function requireProjectSocialAuthConfigId(
  provider: ProjectSocialProvider,
): string {
  const { authConfigEnv } = PROJECT_SOCIAL_PROVIDERS[provider];
  const authConfigId = getEnv()[authConfigEnv];
  if (!authConfigId) {
    throw new ComposioConfigError(
      `${authConfigEnv} is not configured for Project social connections`,
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
  provider: ProjectSocialProvider;
  action: "connect" | "reconnect" | "replace";
  socialConnectionId: string | null;
  authConfigId: string;
  callbackRedeemedAt: Date | null;
  expiresAt: Date;
}

interface ProjectSocialConnectionIntentCandidate
  extends Omit<ProjectSocialConnectionIntentClaim, "action" | "provider"> {
  action: string;
  provider: string;
}

function isLiveIntent(
  intent: ProjectSocialConnectionIntentCandidate | null,
  input: FinalizeProjectSocialConnectionInput,
): intent is ProjectSocialConnectionIntentClaim {
  return Boolean(
    intent &&
      intent.projectId === input.projectId &&
      intent.initiatingUserId === input.userId &&
      isProjectSocialProvider(intent.provider) &&
      isConnectionAction(intent.action) &&
      (getZernioAccountId(input.connectionId)
        ? (intent.provider === "tiktok" || intent.provider === "linkedin") &&
          input.callbackProof &&
          zernioProofDigest(input.callbackProof) === intent.authConfigId
        : intent.callbackRedeemedAt !== null) &&
      intent.expiresAt > new Date(),
  );
}

export async function requireScopedProject(
  input: { projectId: string; workspaceId: string },
  {
    client = prisma,
    requireOpen = false,
    closedMessage = "Cannot connect accounts to a closing or closed Project",
  }: {
    client?: Pick<Prisma.TransactionClient, "project">;
    requireOpen?: boolean;
    /** Message of the 409 for a closing or closed Project. */
    closedMessage?: string;
  } = {},
) {
  const project = await client.project.findFirst({
    where: { id: input.projectId, workspaceId: input.workspaceId },
    select: {
      id: true,
      closingAt: true,
      closedAt: true,
      testCopyOfProjectId: true,
      ...socialProviderProjectSelect,
    },
  });
  if (!project) {
    throw notFound("Project not found");
  }
  if (requireOpen && (project.closingAt || project.closedAt)) {
    throw conflict(closedMessage);
  }
  return project;
}

export async function requireLockedOpenProject(
  tx: Prisma.TransactionClient,
  input: { projectId: string; workspaceId: string },
  options: { closedMessage?: string } = {},
) {
  if (!(await lockCalendarScope(tx, input.workspaceId, [input.projectId]))) {
    throw notFound("Project not found");
  }
  return requireScopedProject(input, {
    client: tx,
    requireOpen: true,
    ...options,
  });
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

export async function initiateProjectSocialConnection(
  input: InitiateProjectSocialConnectionInput,
): Promise<{ connectionId: string; redirectUrl: string }> {
  const project = await requireScopedProject(input, { requireOpen: true });
  if (project.testCopyOfProjectId) {
    throw conflict("A test copy uses the accounts of the Cuso it copies");
  }
  if (input.action === "connect" && input.socialConnectionId) {
    throw conflict("A new connection cannot target an existing social account");
  }
  let provider: ProjectSocialProvider;
  let composioReconnect = false;
  if (input.action === "connect") {
    provider = input.provider;
  } else {
    const target = await requireTargetConnection(input);
    requireInitiationTargetState(target, input.action);
    if (!isProjectSocialProvider(target.provider)) {
      throw notFound("Unsupported social connection provider");
    }
    provider = target.provider;
    // A reconnect stays with the provider that holds the account.
    composioReconnect =
      input.action === "reconnect" &&
      !getZernioAccountId(target.composioConnectedAccountId);
  }

  requireSocialProviderEnabled(provider, project);
  if (provider === "tiktok" && composioReconnect) {
    requireOwnTikTokAppAllowed(project);
  }
  const zernioPlatform = composioReconnect
    ? null
    : provider === "tiktok"
      ? ("tiktok" as const)
      : provider === "linkedin" &&
          input.accountChoice &&
          getEnv().ZERNIO_API_KEY
        ? ("linkedin" as const)
        : null;
  const useZernio = zernioPlatform !== null;
  const composioConfigId = useZernio
    ? null
    : requireProjectSocialAuthConfigId(provider);
  if (useZernio && !getEnv().ZERNIO_API_KEY) throw integrationNotConfigured();
  if (input.action === "replace") {
    const retiredConnection = await serializableTransaction(async (tx) => {
      requireSocialProviderEnabled(
        provider,
        await requireLockedOpenProject(tx, input),
      );
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
      if (target.provider !== provider) {
        throw conflict("The social connection provider changed. Please retry.");
      }

      return retireProjectSocialConnection(
        tx,
        target,
        input.userId,
        "replace_retire",
      );
    }, "Project social connection changed. Please retry.");

    await revokeRetiredProjectSocialConnection(retiredConnection);
  }

  const callbackUrl =
    input.callbackUrl &&
    new URL(input.callbackUrl).pathname !== "/zernio/callback"
      ? input.callbackUrl
      : undefined;
  const connection = composioConfigId
    ? {
        ...(await initiateComposioConnection({
          authConfigId: composioConfigId,
          connectorUserId: projectConnectorUserId(input.userId),
          executorUserId: projectExecutorUserId(input.projectId),
          callbackUrl: callbackUrl ?? `${getWebAppBaseUrl()}/composio/callback`,
        })),
        authConfigId: composioConfigId,
      }
    : await createZernioIntent(
        input.callbackUrl ?? getWebAppBaseUrl(),
        zernioPlatform === "linkedin" ? "LinkedIn" : "TikTok",
      );
  try {
    await serializableTransaction(async (tx) => {
      requireSocialProviderEnabled(
        provider,
        await requireLockedOpenProject(tx, input),
      );
      await tx.projectSocialConnectionIntent.create({
        data: {
          connectionId: connection.connectionId,
          projectId: input.projectId,
          initiatingUserId: input.userId,
          provider,
          action: input.action,
          socialConnectionId: input.socialConnectionId ?? null,
          authConfigId: connection.authConfigId,
          expiresAt: new Date(Date.now() + INTENT_TTL_MS),
        },
      });
    }, "Project changed while connecting a social account");
  } catch (error) {
    // The hosted link has not left Core, so this unclaimed account cannot be used.
    await deleteProviderIntent(connection.connectionId);
    throw error;
  }

  if ("profileId" in connection) {
    if (!zernioPlatform) throw new Error("Missing Zernio platform");
    // Persist the profile before requesting consent so abandoned or failed handoffs can be reclaimed.
    const redirectUrl = await getZernioAuthUrl(
      zernioPlatform,
      connection.profileId,
      connection.callback,
    );
    return { connectionId: connection.connectionId, redirectUrl };
  }
  return {
    connectionId: connection.connectionId,
    redirectUrl: composioHandoffUrl({
      redirectUrl: connection.redirectUrl,
      returnUrl: callbackUrl,
      connectionId: connection.connectionId,
    }),
  };
}

/** The owner's pick, else the account a reconnect keeps, else whether to ask. */
async function accountPick(
  input: FinalizeProjectSocialConnectionInput,
  intent: ProjectSocialConnectionIntentClaim,
): Promise<SocialAccountPick> {
  return {
    choiceId: input.accountChoiceId,
    externalAccountId: input.accountChoiceId
      ? undefined
      : await reconnectedAccountId(intent),
    offerChoice: input.offerChoice,
  };
}

/** A Facebook login's pick, only when there is one to make or to ask for. */
async function facebookPick(
  input: FinalizeProjectSocialConnectionInput,
  intent: ProjectSocialConnectionIntentClaim,
): Promise<{ pick: SocialAccountPick } | null> {
  const pick = await accountPick(input, intent);
  return pick.choiceId || pick.externalAccountId || pick.offerChoice
    ? { pick }
    : null;
}

/** A reconnect signs in to the account the row already holds: nothing to pick. */
async function reconnectedAccountId(
  intent: ProjectSocialConnectionIntentClaim,
): Promise<string | undefined> {
  if (intent.action !== "reconnect" || !intent.socialConnectionId) return;
  const target = await prisma.projectSocialConnection.findFirst({
    where: { id: intent.socialConnectionId, projectId: intent.projectId },
    select: { externalAccountId: true },
  });
  return target?.externalAccountId;
}

async function getClaimedComposioIdentity(
  input: FinalizeProjectSocialConnectionInput,
  intent: ProjectSocialConnectionIntentClaim,
) {
  const authConfigId = intent.authConfigId;
  const account = await getComposioConnectedAccount(input.connectionId);
  if (
    account.id !== input.connectionId ||
    account.toolkitSlug !==
      PROJECT_SOCIAL_PROVIDERS[intent.provider].toolkitSlug ||
    account.authConfigId !== authConfigId ||
    account.connectorUserId !== projectConnectorUserId(input.userId)
  ) {
    throw notFound("Unknown or expired connection");
  }
  if (account.status !== "ACTIVE") {
    throw conflict("Connection is not active");
  }

  const identity = await getConnectedSocialIdentity({
    provider: intent.provider,
    connectedAccountId: input.connectionId,
    executorUserId: projectExecutorUserId(input.projectId),
    ...(intent.provider === "facebook" && (await facebookPick(input, intent))),
  });
  return { identity, connectedAccountId: input.connectionId };
}

async function getZernioIdentity(
  input: FinalizeProjectSocialConnectionInput,
  intent: ProjectSocialConnectionIntentClaim,
  profileId: string,
) {
  if (intent.provider !== "linkedin") {
    return getZernioProfileIdentity(profileId, "tiktok");
  }
  // A sign-in with nothing to pick comes back with the account already kept.
  if (!input.pendingDataToken) {
    return getZernioProfileIdentity(profileId, "linkedin");
  }
  if (!input.connectToken) throw notFound("Unknown or expired connection");
  return connectZernioLinkedInAccount({
    profileId,
    pendingDataToken: input.pendingDataToken,
    connectToken: input.connectToken,
    pick: await accountPick(input, intent),
  });
}

export async function finalizeProjectSocialConnection(
  input: FinalizeProjectSocialConnectionInput,
): Promise<ProjectSocialConnectionSummary> {
  const project = await requireScopedProject(input, { requireOpen: true });
  const intent = await prisma.projectSocialConnectionIntent.findUnique({
    where: { connectionId: input.connectionId },
  });
  if (!isLiveIntent(intent, input)) {
    throw notFound("Unknown or expired connection");
  }

  requireSocialProviderEnabled(intent.provider, project);

  const connectorUserId = projectConnectorUserId(input.userId);
  const profileId = getZernioAccountId(input.connectionId);
  const { identity, connectedAccountId } = profileId
    ? await getZernioIdentity(input, intent, profileId)
    : await getClaimedComposioIdentity(input, intent);
  const avatarUrl = identity.avatarUrl
    ? await snapshotSocialAccountAvatar({
        projectId: input.projectId,
        provider: intent.provider,
        externalAccountId: identity.id,
        avatarUrl: identity.avatarUrl,
      })
    : null;
  const { summary, retiredConnection, replacedAvatarUrl } =
    await serializableTransaction(async (tx) => {
      requireSocialProviderEnabled(
        intent.provider,
        await requireLockedOpenProject(tx, input),
      );
      const now = new Date();
      const currentIntent = await tx.projectSocialConnectionIntent.findUnique({
        where: { connectionId: input.connectionId },
      });
      if (
        !isLiveIntent(currentIntent, input) ||
        currentIntent.provider !== intent.provider ||
        currentIntent.authConfigId !== intent.authConfigId ||
        currentIntent.action !== intent.action ||
        currentIntent.socialConnectionId !== intent.socialConnectionId
      ) {
        throw notFound("Unknown or expired connection");
      }
      const key = activeExternalAccountKey(currentIntent.provider, identity.id);
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
        if (target.provider !== currentIntent.provider) {
          throw conflict(
            "The connection provider must match the existing account",
          );
        }
        if (
          currentIntent.action === "reconnect" &&
          !isSameExternalAccount(
            target.provider,
            target.externalAccountId,
            identity.id,
          )
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
            activeExternalAccountKey: {
              in: activeExternalAccountKeys(
                currentIntent.provider,
                identity.id,
              ),
            },
            ...(target ? { NOT: { id: target.id } } : {}),
          },
        });
        if (duplicate) {
          throw conflict(
            "This social account is already connected to the Project",
          );
        }
      }

      let connection: ProjectSocialConnectionRecord;
      let retiredConnection: RetiredProjectSocialConnection | undefined;
      if (currentIntent.action === "reconnect" && target) {
        if (target.composioConnectedAccountId !== connectedAccountId) {
          const retirementAudit = await tx.projectSocialConnectionAudit.create({
            data: {
              projectSocialConnectionId: target.id,
              action: "reconnect_retire",
              actorId: input.userId,
              externalAccountId: target.externalAccountId,
              externalHandle: target.externalHandle,
              connectedAccountId: target.composioConnectedAccountId,
              zernioProfileId: target.zernioProfileId,
              providerOutcome: "local_disconnect",
            },
          });
          retiredConnection = {
            auditId: retirementAudit.id,
            connectedAccountId: target.composioConnectedAccountId,
            zernioProfileId: target.zernioProfileId,
            socialConnectionId: target.id,
          };
        }
        connection = await tx.projectSocialConnection.update({
          where: { id: target.id },
          data: {
            composioConnectedAccountId: connectedAccountId,
            zernioProfileId: profileId,
            connectorUserId,
            // Rewrites a legacy LinkedIn URN row to the bare id.
            ...(target.externalAccountId !== identity.id
              ? { externalAccountId: identity.id }
              : {}),
            externalHandle: identity.handle,
            displayName: identity.displayName,
            subscriptionType: identity.subscriptionType,
            // A failed avatar copy keeps the previous one.
            ...(avatarUrl ? { avatarUrl } : {}),
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
            provider: currentIntent.provider,
            externalAccountId: identity.id,
            externalHandle: identity.handle,
            displayName: identity.displayName,
            subscriptionType: identity.subscriptionType,
            avatarUrl,
            composioConnectedAccountId: connectedAccountId,
            zernioProfileId: profileId,
            status: "active",
            activeExternalAccountKey: key,
            connectorUserId,
            connectedAt: now,
          },
        });
        if (currentIntent.action === "replace" && target) {
          await tx.socialPost.updateMany({
            where: {
              projectId: input.projectId,
              socialConnectionId: target.id,
              status: { in: ["DRAFT", "NEEDS_APPROVAL", "SCHEDULED"] },
            },
            data: { socialConnectionId: connection.id },
          });
        }
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
        // Only a reconnect overwrites the row's avatar. A replaced account's
        // row stays, and its old posts still show that avatar.
        replacedAvatarUrl:
          currentIntent.action === "reconnect" &&
          avatarUrl &&
          target?.avatarUrl !== avatarUrl
            ? (target?.avatarUrl ?? null)
            : null,
      };
    }, "Project social connection changed. Please retry.").catch(
      async (error) => {
        await deleteSocialAccountAvatarIfOwned(avatarUrl, input.projectId);
        if (isPrismaUniqueViolation(error)) {
          throw conflict(
            "This social account is already connected to the Project",
          );
        }
        throw error;
      },
    );

  if (retiredConnection) {
    await revokeRetiredProjectSocialConnection(retiredConnection);
  }
  await deleteSocialAccountAvatarIfOwned(replacedAvatarUrl, input.projectId);

  return summary;
}

async function revokeRetiredProjectSocialConnection(
  input: RetiredProjectSocialConnection,
): Promise<"revoked" | "skipped_shared" | "failed"> {
  // A test copy's link is never the account's owner: only the Project that
  // connected the account may end it at the provider (ADR 0073).
  const stillReferenced = await prisma.projectSocialConnection.findFirst({
    where: {
      OR: [
        { id: input.socialConnectionId, executorProjectId: { not: null } },
        {
          composioConnectedAccountId: input.connectedAccountId,
          status: { not: "disconnected" },
          NOT: { id: input.socialConnectionId },
        },
      ],
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
    const accountId = getZernioAccountId(input.connectedAccountId);
    if (accountId) {
      if (!input.zernioProfileId) throw new Error("Missing Zernio profile");
      await deleteZernioProfile(input.zernioProfileId, accountId);
    } else {
      await revokeComposioConnectedAccount({
        connectedAccountId: input.connectedAccountId,
      });
    }
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
  return connections
    .filter((connection) => connection.status !== "disconnected")
    .map(mapProjectSocialConnection);
}

export async function disconnectProjectSocialConnection(
  input: DisconnectProjectSocialConnectionInput,
): Promise<{
  connection: ProjectSocialConnectionSummary;
  providerRevocation: "succeeded" | "failed" | "skipped";
}> {
  await requireScopedProject(input);
  const existing = await requireTargetConnection({
    projectId: input.projectId,
    socialConnectionId: input.socialConnectionId,
  });
  if (existing.status === "disconnected") {
    return {
      connection: mapProjectSocialConnection(existing),
      providerRevocation: "skipped",
    };
  }

  const now = new Date();
  const { connection, ...retired } = await serializableTransaction(
    async (tx) => {
      if (!(await lockCalendarScope(tx, input.workspaceId, [input.projectId])))
        throw notFound("Project not found");
      const current = await tx.projectSocialConnection.findUnique({
        where: { id: existing.id },
      });
      if (!current) throw notFound("Project social connection not found");
      const retired = await retireProjectSocialConnection(
        tx,
        current,
        input.userId,
        "disconnect",
      );
      return {
        ...retired,
        connection: {
          ...current,
          status: "disconnected",
          activeExternalAccountKey: null,
          disconnectedAt: now,
        },
      };
    },
    "Project social connection changed. Please retry.",
  );

  const providerRevocation =
    await revokeRetiredProjectSocialConnection(retired);
  return {
    connection: mapProjectSocialConnection(connection),
    providerRevocation:
      providerRevocation === "revoked"
        ? "succeeded"
        : providerRevocation === "failed"
          ? "failed"
          : "skipped",
  };
}

interface RetiredProjectSocialConnection {
  zernioProfileId?: string | null;
  auditId: string;
  connectedAccountId: string;
  socialConnectionId: string;
}

async function retireProjectSocialConnection(
  tx: Prisma.TransactionClient,
  connection: ProjectSocialConnectionRecord,
  actorId: string,
  action: "disconnect" | "replace_retire" | "project_close",
): Promise<RetiredProjectSocialConnection> {
  await tx.projectSocialConnection.update({
    where: { id: connection.id },
    data: {
      status: "disconnected",
      activeExternalAccountKey: null,
      disconnectedAt: new Date(),
    },
  });
  const audit = await tx.projectSocialConnectionAudit.create({
    data: {
      projectSocialConnectionId: connection.id,
      action,
      actorId,
      externalAccountId: connection.externalAccountId,
      externalHandle: connection.externalHandle,
      connectedAccountId: connection.composioConnectedAccountId,
      zernioProfileId: connection.zernioProfileId,
      providerOutcome: "local_disconnect",
    },
  });
  return {
    auditId: audit.id,
    connectedAccountId: connection.composioConnectedAccountId,
    zernioProfileId: connection.zernioProfileId,
    socialConnectionId: connection.id,
  };
}

/** Called inside the transaction that marks the locked Project as closing. */
export async function retireProjectSocialConnectionsForClose(
  tx: Prisma.TransactionClient,
  projectId: string,
  actorId: string,
): Promise<void> {
  const connections = await tx.projectSocialConnection.findMany({
    where: {
      projectId,
      OR: [
        { status: { not: "disconnected" } },
        {
          audits: {
            some: {
              action: {
                in: ["disconnect", "replace_retire", "reconnect_retire"],
              },
              providerOutcome: {
                in: ["local_disconnect", "revocation_failed"],
              },
            },
          },
        },
      ],
    },
  });
  for (const connection of connections) {
    if (connection.status === "disconnected") continue;
    await retireProjectSocialConnection(
      tx,
      connection,
      actorId,
      "project_close",
    );
  }
  await tx.projectSocialConnectionIntent.updateMany({
    where: { projectId },
    data: { expiresAt: new Date() },
  });
}

interface ProjectSocialRevocation {
  connectedAccountId: string;
  retirement?: RetiredProjectSocialConnection;
}

/** Audit outcomes and expired intents retain provider cleanup work across retries. */
export async function getPendingProjectSocialRevocation(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<ProjectSocialRevocation | null> {
  const audit = await tx.projectSocialConnectionAudit.findFirst({
    where: {
      action: {
        in: [
          "disconnect",
          "replace_retire",
          "reconnect_retire",
          "project_close",
        ],
      },
      providerOutcome: { in: ["local_disconnect", "revocation_failed"] },
      projectSocialConnection: { projectId },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { projectSocialConnection: true },
  });
  if (audit) {
    const connection = audit.projectSocialConnection;
    const connectedAccountId =
      audit.connectedAccountId ?? connection.composioConnectedAccountId;
    return {
      connectedAccountId,
      retirement: {
        auditId: audit.id,
        zernioProfileId: audit.zernioProfileId,
        socialConnectionId: connection.id,
        connectedAccountId,
      },
    };
  }
  const intent = await tx.projectSocialConnectionIntent.findFirst({
    where: { projectId },
    orderBy: { connectionId: "asc" },
    select: { connectionId: true },
  });
  return intent ? { connectedAccountId: intent.connectionId } : null;
}

async function deleteProviderIntent(
  connectionId: string,
  signal?: AbortSignal,
) {
  const profileId = getZernioAccountId(connectionId);
  if (profileId) {
    await deleteZernioProfile(profileId, undefined, signal);
  } else {
    await deleteProjectSocialConnectionIntent({
      connectedAccountId: connectionId,
    });
  }
}

/** Claim an expired intent before external cleanup so an in-flight finalization cannot keep its account. */
export async function cleanExpiredZernioIntents(input: {
  signal: AbortSignal;
  shouldContinue: () => boolean;
}) {
  const now = new Date();
  const intents = await prisma.projectSocialConnectionIntent.findMany({
    where: { connectionId: { startsWith: "zernio:" }, expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" },
    take: 10,
    select: { connectionId: true },
  });
  let cleaned = 0;
  let failed = 0;
  for (const { connectionId } of intents) {
    if (!input.shouldContinue()) break;
    const claimed = await prisma.projectSocialConnectionIntent.updateMany({
      where: { connectionId, expiresAt: { lte: now } },
      // A non-digest invalidates the callback permanently. Retry failed removals in 15 minutes.
      data: {
        authConfigId: "expired",
        expiresAt: new Date(Date.now() + INTENT_TTL_MS),
      },
    });
    if (!claimed.count) continue;
    try {
      await deleteProviderIntent(connectionId, input.signal);
      await prisma.projectSocialConnectionIntent.deleteMany({
        where: { connectionId },
      });
      cleaned++;
    } catch {
      failed++;
    }
  }
  return { cleaned, failed };
}

export async function revokeProjectSocialConnectionForClose(
  pending: ProjectSocialRevocation,
): Promise<void> {
  if (pending.retirement) {
    if (
      (await revokeRetiredProjectSocialConnection(pending.retirement)) ===
      "failed"
    ) {
      throw new Error("Social account authorization could not be revoked");
    }
    return;
  }
  await deleteProviderIntent(pending.connectedAccountId);
  await prisma.projectSocialConnectionIntent.deleteMany({
    where: { connectionId: pending.connectedAccountId },
  });
}

const LINKEDIN_PERSON_URN_PREFIX = "urn:li:person:";

function linkedInPersonKey(value: string): string {
  return value.startsWith(LINKEDIN_PERSON_URN_PREFIX)
    ? value.slice(LINKEDIN_PERSON_URN_PREFIX.length)
    : value;
}

/**
 * Best effort backfill for LinkedIn accounts connected before their photo was
 * read: looks the identity up again and stores the photo (and a missing name)
 * only while the row still has none. Never throws.
 */
export async function backfillLinkedInAccountProfile(connection: {
  id: string;
  projectId: string;
  provider: string;
  status: string;
  composioConnectedAccountId: string;
  executorProjectId?: string | null;
  externalAccountId: string;
  avatarUrl: string | null;
}): Promise<boolean> {
  if (
    connection.provider !== "linkedin" ||
    connection.status !== "active" ||
    connection.avatarUrl ||
    // Zernio's account carries its own picture; Composio cannot read it.
    getZernioAccountId(connection.composioConnectedAccountId)
  ) {
    return false;
  }
  let snapshot: string | null = null;
  try {
    const identity = await getConnectedSocialIdentity({
      provider: "linkedin",
      connectedAccountId: connection.composioConnectedAccountId,
      executorUserId: connectionExecutorUserId(connection),
    });
    if (
      linkedInPersonKey(identity.id) !==
      linkedInPersonKey(connection.externalAccountId)
    ) {
      return false;
    }
    if (!identity.avatarUrl) return false;
    snapshot = await snapshotSocialAccountAvatar({
      projectId: connection.projectId,
      provider: "linkedin",
      externalAccountId: connection.externalAccountId,
      avatarUrl: identity.avatarUrl,
    });
    if (!snapshot) return false;
    const updated = await prisma.projectSocialConnection.updateMany({
      where: { id: connection.id, status: "active", avatarUrl: null },
      data: { avatarUrl: snapshot },
    });
    if (identity.displayName) {
      await prisma.projectSocialConnection.updateMany({
        where: { id: connection.id, displayName: null },
        data: { displayName: identity.displayName },
      });
    }
    if (updated.count === 0) {
      await deleteSocialAccountAvatarIfOwned(snapshot, connection.projectId);
      return false;
    }
    return true;
  } catch {
    // Runs in the social account sync: its cron, or detached after a refresh.
    emitCoreWarning(
      {
        operation: "linkedin_profile_backfill",
        socialConnection: {
          id: connection.id,
          projectId: connection.projectId,
        },
      },
      {
        message: "Could not backfill a LinkedIn account's profile photo",
        why: "Reading the LinkedIn identity or storing its photo failed",
        fix: "Nothing to do: the next social account sync tries again while the account has no photo.",
      },
    );
    if (snapshot) {
      await deleteSocialAccountAvatarIfOwned(
        snapshot,
        connection.projectId,
      ).catch(() => {});
    }
    return false;
  }
}
