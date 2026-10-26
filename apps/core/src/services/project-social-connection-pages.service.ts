import {
  isLinkedInOrganization,
  linkedInAuthorUrn,
} from "@/clients/social-post-providers/linkedin-author";
import {
  getLinkedInOrganization,
  listLinkedInAdministeredOrganizations,
  listLinkedInAdministeredOrganizationUrns,
} from "@/clients/social-post-providers/linkedin-organizations";
import { getEnv } from "@/config/env";
import { requireSocialProviderEnabled } from "@/config/social-providers";
import { badRequest, conflict, forbidden, notFound } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  deleteSocialAccountAvatarIfOwned,
  snapshotSocialAccountAvatar,
} from "@/lib/social-account-avatar";
import {
  activeExternalAccountKey,
  mapProjectSocialConnection,
  type ProjectSocialConnectionSummary,
  projectExecutorUserId,
  requireLockedOpenProject,
  requireScopedProject,
} from "@/services/project-social-connections.service";

/**
 * Pages a connected account can post as, each added as its own Project
 * account that shares the source account's Composio authorization. Only
 * LinkedIn company pages today; a Facebook Page picker would slot in here.
 */

export interface ProjectSocialConnectionPage {
  externalAccountId: string;
  name: string | null;
  handle: string | null;
  logoUrl: string | null;
  socialConnectionId: string | null;
}

export interface ProjectSocialConnectionPages {
  status: "available" | "permission_missing";
  pages: ProjectSocialConnectionPage[];
}

interface PageSourceInput {
  projectId: string;
  workspaceId: string;
  socialConnectionId: string;
}

export const LINKEDIN_PAGE_PERMISSION_MISSING_MESSAGE =
  "Posting as a company page needs extra LinkedIn permission. Reconnect LinkedIn after your admin enables it.";

/** Off by default: the LinkedIn app needs Community Management API approval first. */
function requireCompanyPagesEnabled(): void {
  if (!getEnv().SOCIAL_LINKEDIN_COMPANY_PAGES_ENABLED) {
    throw notFound("Not Found");
  }
}

/** The personal LinkedIn account whose pages are listed or added. */
async function requirePageSource(
  input: PageSourceInput,
  options: { requireOpen?: boolean } = {},
) {
  requireCompanyPagesEnabled();
  const project = await requireScopedProject(input, options);
  const source = await prisma.projectSocialConnection.findFirst({
    where: { id: input.socialConnectionId, projectId: input.projectId },
  });
  if (
    !source ||
    source.provider !== "linkedin" ||
    isLinkedInOrganization(source.externalAccountId)
  ) {
    throw notFound("Project social connection not found");
  }
  if (source.status !== "active") {
    throw conflict("Connection is not active");
  }
  requireSocialProviderEnabled(source.provider, project);
  return source;
}

export async function listProjectSocialConnectionPages(
  input: PageSourceInput,
): Promise<ProjectSocialConnectionPages> {
  const source = await requirePageSource(input);
  const result = await listLinkedInAdministeredOrganizations({
    connectedAccountId: source.composioConnectedAccountId,
    executorUserId: projectExecutorUserId(input.projectId),
  });
  if (result.status === "permission_missing") {
    return { status: "permission_missing", pages: [] };
  }
  const added = await prisma.projectSocialConnection.findMany({
    where: {
      projectId: input.projectId,
      provider: "linkedin",
      status: { not: "disconnected" },
      externalAccountId: {
        in: result.organizations.map((organization) => organization.urn),
      },
    },
    select: { id: true, externalAccountId: true },
  });
  const addedIds = new Map(
    added.map((row) => [row.externalAccountId, row.id] as const),
  );
  return {
    status: "available",
    pages: result.organizations.map((organization) => ({
      externalAccountId: organization.urn,
      name: organization.name,
      handle: organization.vanityName,
      logoUrl: organization.logoUrl,
      socialConnectionId: addedIds.get(organization.urn) ?? null,
    })),
  };
}

/**
 * Adds a page as a Project account after LinkedIn confirms the member still
 * administers it. Adding a page that is already there returns that account.
 */
export async function addProjectSocialConnectionPage(
  input: PageSourceInput & { userId: string; externalAccountId: string },
): Promise<ProjectSocialConnectionSummary> {
  requireCompanyPagesEnabled();
  if (!isLinkedInOrganization(input.externalAccountId)) {
    throw badRequest("Choose a LinkedIn company page");
  }
  const source = await requirePageSource(input, { requireOpen: true });
  const urn = linkedInAuthorUrn(input.externalAccountId);
  const key = activeExternalAccountKey("linkedin", urn);
  const findExisting = () =>
    prisma.projectSocialConnection.findFirst({
      where: { projectId: input.projectId, activeExternalAccountKey: key },
    });
  const existing = await findExisting();
  if (existing) return mapProjectSocialConnection(existing);

  const connection = {
    connectedAccountId: source.composioConnectedAccountId,
    executorUserId: projectExecutorUserId(input.projectId),
  };
  const administered =
    await listLinkedInAdministeredOrganizationUrns(connection);
  if (!administered) throw forbidden(LINKEDIN_PAGE_PERMISSION_MISSING_MESSAGE);
  if (!administered.includes(urn)) {
    throw forbidden("You do not administer this LinkedIn page");
  }
  const page = await getLinkedInOrganization({ ...connection, urn });
  const avatarUrl = page.logoUrl
    ? await snapshotSocialAccountAvatar({
        projectId: input.projectId,
        provider: "linkedin",
        externalAccountId: urn,
        avatarUrl: page.logoUrl,
      })
    : null;

  let added: { summary: ProjectSocialConnectionSummary; created: boolean };
  try {
    added = await serializableTransaction(async (tx) => {
      await requireLockedOpenProject(tx, input);
      const current = await tx.projectSocialConnection.findUnique({
        where: { id: source.id },
      });
      if (
        current?.status !== "active" ||
        current.composioConnectedAccountId !== source.composioConnectedAccountId
      ) {
        throw conflict("The LinkedIn account changed. Please retry.");
      }
      const duplicate = await tx.projectSocialConnection.findFirst({
        where: { projectId: input.projectId, activeExternalAccountKey: key },
      });
      if (duplicate) {
        return {
          summary: mapProjectSocialConnection(duplicate),
          created: false,
        };
      }
      const created = await tx.projectSocialConnection.create({
        data: {
          projectId: input.projectId,
          provider: "linkedin",
          externalAccountId: urn,
          externalHandle: page.vanityName,
          displayName: page.name,
          avatarUrl,
          composioConnectedAccountId: current.composioConnectedAccountId,
          status: "active",
          activeExternalAccountKey: key,
          connectorUserId: current.connectorUserId,
          connectedAt: new Date(),
        },
      });
      await tx.projectSocialConnectionAudit.create({
        data: {
          projectSocialConnectionId: created.id,
          action: "connect",
          actorId: input.userId,
          externalAccountId: urn,
          externalHandle: page.vanityName,
          connectedAccountId: current.composioConnectedAccountId,
          providerOutcome: "active",
        },
      });
      return { summary: mapProjectSocialConnection(created), created: true };
    }, "Project social connection changed. Please retry.");
  } catch (error) {
    await deleteSocialAccountAvatarIfOwned(avatarUrl, input.projectId);
    if (!isPrismaUniqueViolation(error)) throw error;
    // A concurrent add of the same page won the race.
    const winner = await findExisting();
    if (!winner) throw error;
    return mapProjectSocialConnection(winner);
  }
  if (!added.created) {
    await deleteSocialAccountAvatarIfOwned(avatarUrl, input.projectId);
  }
  return added.summary;
}
