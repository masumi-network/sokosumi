import { socialPostProviderLabel } from "@sokosumi/utils";
import prisma from "@/lib/db/prisma";
import {
  containsExactName,
  mentionedSocialProviders,
  mentionsNewsletter,
  namedProjectsIn,
  namedSocialDestinations,
  type SocialDestinationCandidate,
  socialDestinationLabel,
  socialHandleOf,
  withoutQuotedCopy,
} from "./ask-policy-match";

const MAX_CANDIDATE_PROJECTS = 200;
const MAX_SHOWN_CANDIDATES = 10;

export interface AskPolicyHintsInput {
  workspaceId: string;
  /** Null for a workspace-wide personal bot; set for a single-project shared bot. */
  projectId: string | null;
  message: string;
  /** True when an open SokoBotAccountQuestion already carries the pending choice. */
  hasOpenAccountQuestion?: boolean;
}

export interface AskPolicyProjectSelectionInput {
  workspaceId: string;
  botProjectId: string | null;
  projectIds: readonly string[];
  /** Empty for non-owner or child runs whose userMessage is not the owner's words. */
  userMessage: string;
}

interface NewsletterCandidate {
  id: string;
  name: string;
  projectId: string;
  project: { id: string; name: string };
}

function formatCapped<T>(
  items: readonly T[],
  format: (item: T) => string,
): string {
  const shown = items.slice(0, MAX_SHOWN_CANDIDATES).map(format).join("; ");
  const extra = items.length - MAX_SHOWN_CANDIDATES;
  return extra > 0 ? `${shown}; and ${extra} more` : shown;
}

function namedNewslettersIn(
  message: string,
  newsletters: readonly NewsletterCandidate[],
): NewsletterCandidate[] {
  const text = withoutQuotedCopy(message);
  return newsletters.filter((newsletter) => {
    if (text.includes(newsletter.id) || text.includes(newsletter.project.id)) {
      return true;
    }
    const newsletterName = newsletter.name.trim();
    if (newsletterName.length >= 3 && containsExactName(text, newsletterName)) {
      return true;
    }
    const projectName = newsletter.project.name.trim();
    return projectName.length >= 3 && containsExactName(text, projectName);
  });
}

function openProjectWhereFor(workspaceId: string, projectId: string | null) {
  return {
    workspaceId,
    closedAt: null,
    closingAt: null,
    ...(projectId ? { id: projectId } : {}),
  } as const;
}

/**
 * Prepare live candidate verdicts from Core's own records before a foreground
 * chat turn begins (gated behind `SokoBotVersion.askPolicy`).
 *
 * - 1 fitting candidate: use it directly and say which one.
 * - Several fitting candidates (none named): ask once, change nothing.
 * - 0 fitting candidates: say plainly what is missing, change nothing.
 */
export async function prepareAskPolicyHints(
  input: AskPolicyHintsInput,
): Promise<string[]> {
  const openProjectWhere = openProjectWhereFor(
    input.workspaceId,
    input.projectId,
  );
  const providers = mentionedSocialProviders(input.message);
  const wantsNewsletter = mentionsNewsletter(input.message);

  const [openProjects, socialConnections, newsletters] = await Promise.all([
    input.projectId
      ? Promise.resolve([])
      : prisma.project.findMany({
          where: openProjectWhere,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: MAX_CANDIDATE_PROJECTS,
          select: { id: true, name: true },
        }),
    providers.length > 0
      ? prisma.projectSocialConnection.findMany({
          where: {
            provider: { in: providers },
            status: "active",
            project: openProjectWhere,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            provider: true,
            externalHandle: true,
            project: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
    wantsNewsletter
      ? prisma.newsletter.findMany({
          where: {
            workspaceId: input.workspaceId,
            ...(input.projectId ? { projectId: input.projectId } : {}),
            project: openProjectWhere,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            name: true,
            projectId: true,
            project: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const hints: string[] = [];

  for (const provider of providers) {
    const label = socialPostProviderLabel(provider);
    const forProvider: SocialDestinationCandidate[] = socialConnections.filter(
      (connection) => connection.provider === provider,
    );
    if (forProvider.length === 0) {
      hints.push(
        `Core social records: 0 active ${label} accounts are connected in scope. If this request creates, drafts, or schedules a ${label} post, do not ask which project to use — tell the owner no ${label} account is connected and make no social changes.`,
      );
      continue;
    }
    const named = namedSocialDestinations(input.message, forProvider);
    if (named.length === 1) {
      hints.push(
        `Core social records: exactly 1 fitting ${label} destination in scope — ${socialDestinationLabel(named[0])}. If this request posts or schedules on ${label}, use this account and project directly without asking which project or account, and state which one you used in one line (ids are for tools; never show raw ids).`,
      );
    } else if (named.length >= 2) {
      hints.push(
        `Core social records: the request explicitly names ${named.length} active ${label} accounts — ${formatCapped(named, socialDestinationLabel)}. Use those named destinations directly without asking which project or account (ids are for tools; never show raw ids).`,
      );
    } else if (forProvider.length === 1) {
      hints.push(
        `Core social records: exactly 1 fitting ${label} destination in scope — ${socialDestinationLabel(forProvider[0])}. If this request posts or schedules on ${label}, use this account and project directly without asking which project or account, and state which one you used in one line (ids are for tools; never show raw ids).`,
      );
    } else if (!input.hasOpenAccountQuestion) {
      hints.push(
        `Core social records: ${forProvider.length} active ${label} accounts in scope and none is named in the request — ${formatCapped(forProvider, socialDestinationLabel)}. If this request creates, drafts, or schedules a ${label} post for one destination, ask the owner once which account (@handle or project) to use and make no changes until they answer (ids are for tools; never show raw ids).`,
      );
    }
  }

  if (wantsNewsletter) {
    if (newsletters.length === 0) {
      hints.push(
        "Core newsletter records: 0 newsletters are set up in scope. If this request drafts or sends a newsletter issue, do not ask which project to use — tell the owner no newsletter is set up and make no changes.",
      );
    } else {
      const named = namedNewslettersIn(input.message, newsletters);
      if (named.length === 1) {
        hints.push(
          `Core newsletter records: exactly 1 fitting newsletter in scope — "${named[0].name}" (Project "${named[0].project.name}", projectId ${named[0].project.id}). Use this project directly without asking which project, and state which one you used in one line (ids are for tools; never show raw ids).`,
        );
      } else if (named.length >= 2) {
        hints.push(
          `Core newsletter records: the request explicitly names ${named.length} newsletters — ${formatCapped(named, (n) => `"${n.name}" (Project "${n.project.name}", projectId ${n.project.id})`)}. Use those named newsletters directly without asking which project (ids are for tools; never show raw ids).`,
        );
      } else if (newsletters.length === 1) {
        hints.push(
          `Core newsletter records: exactly 1 fitting newsletter in scope — "${newsletters[0].name}" (Project "${newsletters[0].project.name}", projectId ${newsletters[0].project.id}). Use this project directly without asking which project, and state which one you used in one line (ids are for tools; never show raw ids).`,
        );
      } else {
        hints.push(
          `Core newsletter records: ${newsletters.length} newsletters in scope and none is named in the request — ${formatCapped(newsletters, (n) => `"${n.name}" (Project "${n.project.name}", projectId ${n.project.id})`)}. If this request targets one newsletter, ask the owner once which to use and make no changes until they answer (ids are for tools; never show raw ids).`,
        );
      }
    }
  }

  if (input.projectId === null) {
    if (openProjects.length === 0) {
      hints.push(
        "Core project records: 0 open projects exist in scope. If this request needs a project, tell the owner no open project exists and do not show a project selector.",
      );
    } else if (openProjects.length === 1) {
      hints.push(
        `Core project records: only 1 open project exists in scope — Project "${openProjects[0].name}" (projectId ${openProjects[0].id}). Use it directly for project-scoped work without asking which project or showing a project selector, and state which project you used in one line (ids are for tools; never show raw ids).`,
      );
    } else {
      const namedProjects = namedProjectsIn(input.message, openProjects);
      if (namedProjects.length === 1) {
        hints.push(
          `Core project records: the request names 1 open project — Project "${namedProjects[0].name}" (projectId ${namedProjects[0].id}). Use it directly without asking which project or showing a project selector (ids are for tools; never show raw ids).`,
        );
      }
    }
  }

  return hints;
}

/**
 * Checkable runtime guard on `preview_result({ kind: "project_selection" })`
 * when `SokoBotVersion.askPolicy` is enabled. Returns a clear refusal reason
 * when Core records already narrow the choice to 0 or 1 fitting candidate (or
 * when non-fitting projects were mixed into a network/newsletter picker), or
 * `null` when asking across those projects is justified.
 */
export async function validateAskPolicyProjectSelection(
  input: AskPolicyProjectSelectionInput,
): Promise<string | null> {
  if (input.botProjectId) {
    return `This assistant works in one project only (projectId ${input.botProjectId}). Use it directly without showing a project selector, and state which project you used.`;
  }

  const openProjectWhere = openProjectWhereFor(input.workspaceId, null);
  const uniqueProjectIds = [...new Set(input.projectIds)];
  const [openSample, requested] = await Promise.all([
    prisma.project.findMany({
      where: openProjectWhere,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 2,
      select: { id: true, name: true },
    }),
    uniqueProjectIds.length > 0
      ? prisma.project.findMany({
          where: { ...openProjectWhere, id: { in: uniqueProjectIds } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  if (openSample.length === 0) {
    return "Core records show 0 open projects in this workspace. Do not show a project selector; tell the owner no open project exists.";
  }
  if (openSample.length === 1) {
    return `Core records show only 1 open project in this workspace: Project "${openSample[0].name}" (projectId ${openSample[0].id}). Use it directly without showing a project selector, and state which project you used.`;
  }
  if (requested.length === 0) {
    return "None of those projectIds match an open project in this workspace. Do not show a project selector; tell the owner what is missing.";
  }
  if (requested.length === 1) {
    return `A project selector requires at least 2 open projects, and only Project "${requested[0].name}" (projectId ${requested[0].id}) matched. Use it directly without asking which project, and state which project you used.`;
  }

  if (input.userMessage.trim().length > 0) {
    const providers = mentionedSocialProviders(input.userMessage);
    if (providers.length === 1) {
      const provider = providers[0];
      const label = socialPostProviderLabel(provider);
      const connections: SocialDestinationCandidate[] =
        await prisma.projectSocialConnection.findMany({
          where: {
            provider,
            status: "active",
            project: openProjectWhere,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            externalHandle: true,
            project: { select: { id: true, name: true } },
          },
        });

      if (connections.length === 0) {
        return `Core records show 0 active ${label} accounts connected in this workspace. Do not show a project selector; tell the owner no ${label} account is connected and make no changes.`;
      }

      const namedDestinations = namedSocialDestinations(
        input.userMessage,
        connections,
      );
      if (namedDestinations.length === 1) {
        return `The owner's message already identifies ${socialDestinationLabel(namedDestinations[0])}. Use it directly without showing a project selector.`;
      }

      const byProject = new Map<
        string,
        {
          project: { id: string; name: string };
          accounts: SocialDestinationCandidate[];
        }
      >();
      for (const connection of connections) {
        const existing = byProject.get(connection.project.id);
        if (existing) {
          existing.accounts.push(connection);
        } else {
          byProject.set(connection.project.id, {
            project: connection.project,
            accounts: [connection],
          });
        }
      }

      if (byProject.size === 1) {
        const only = [...byProject.values()][0];
        if (only.accounts.length === 1) {
          return `Core records show exactly 1 fitting ${label} destination: ${socialDestinationLabel(only.accounts[0])}. Use it directly without showing a project selector, and state which one you used.`;
        }
        const handles = only.accounts
          .map((account) => {
            const handle = socialHandleOf(account);
            return handle ? `@${handle}` : `account ${account.id}`;
          })
          .join(", ");
        return `Only Project "${only.project.name}" (projectId ${only.project.id}) has active ${label} accounts (${handles}). Do not show a project selector; ask the owner once which ${label} account to use and make no changes until they answer.`;
      }

      const nonFitting = requested.filter(
        (project) => !byProject.has(project.id),
      );
      if (nonFitting.length > 0) {
        const fittingLabels = formatCapped(
          [...byProject.values()],
          (entry) =>
            `Project "${entry.project.name}" (projectId ${entry.project.id})`,
        );
        return `Only these projects have an active ${label} account: ${fittingLabels}. Offer only fitting projects in project_selection (or ask which @handle to use) and make no changes until the owner answers.`;
      }
      return null;
    }

    if (providers.length === 0 && mentionsNewsletter(input.userMessage)) {
      const newsletters = await prisma.newsletter.findMany({
        where: {
          workspaceId: input.workspaceId,
          project: openProjectWhere,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          projectId: true,
          project: { select: { id: true, name: true } },
        },
      });
      if (newsletters.length === 0) {
        return "Core records show 0 newsletters set up in this workspace. Do not show a project selector; tell the owner no newsletter is set up and make no changes.";
      }
      const named = namedNewslettersIn(input.userMessage, newsletters);
      if (named.length === 1) {
        return `The owner's message already identifies newsletter "${named[0].name}" (Project "${named[0].project.name}", projectId ${named[0].project.id}). Use it directly without showing a project selector.`;
      }
      if (newsletters.length === 1) {
        return `Core records show exactly 1 newsletter: "${newsletters[0].name}" (Project "${newsletters[0].project.name}", projectId ${newsletters[0].project.id}). Use it directly without showing a project selector, and state which project you used.`;
      }
      const fittingIds = new Set(newsletters.map((n) => n.project.id));
      if (requested.some((project) => !fittingIds.has(project.id))) {
        const fittingLabels = formatCapped(
          newsletters,
          (n) =>
            `Project "${n.project.name}" (projectId ${n.project.id}, newsletter "${n.name}")`,
        );
        return `Only these projects have a newsletter: ${fittingLabels}. Offer only fitting projects in project_selection and make no changes until the owner answers.`;
      }
      return null;
    }

    const namedProjects = namedProjectsIn(input.userMessage, requested);
    if (namedProjects.length === 1) {
      return `The owner's message already names Project "${namedProjects[0].name}" (projectId ${namedProjects[0].id}). Use it directly without showing a project selector.`;
    }
  }

  return null;
}
