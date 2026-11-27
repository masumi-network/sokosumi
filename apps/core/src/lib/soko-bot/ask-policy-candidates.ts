import { socialPostProviderLabel } from "@sokosumi/utils";
import prisma from "@/lib/db/prisma";
import {
  containsExactName,
  explicitSocialDestinations,
  mentionedSocialProviders,
  mentionsNewsletter,
  type NamedProjectCandidate,
  namedProjectsIn,
  namedSocialDestinations,
  type SocialDestinationCandidate,
  socialDestinationLabel,
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

function formatProjects(projects: readonly NamedProjectCandidate[]): string {
  return formatCapped(
    projects,
    (project) => `Project "${project.name}" (projectId ${project.id})`,
  );
}

function explicitNewslettersIn(
  message: string,
  newsletters: readonly NewsletterCandidate[],
): NewsletterCandidate[] {
  const text = withoutQuotedCopy(message);
  return newsletters.filter((newsletter) => {
    if (text.includes(newsletter.id)) return true;
    const newsletterName = newsletter.name.trim();
    return (
      newsletterName.length >= 3 && containsExactName(text, newsletterName)
    );
  });
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
 * Resolves any project explicitly named by the owner before counting eligible
 * social/newsletter destinations so Core never substitutes an unrelated project.
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

  const namedProjects =
    input.projectId === null
      ? namedProjectsIn(input.message, openProjects)
      : [];
  const namedProjectIds = new Set(namedProjects.map((project) => project.id));

  const hints: string[] = [];

  for (const provider of providers) {
    const label = socialPostProviderLabel(provider);
    const forProvider: SocialDestinationCandidate[] = socialConnections.filter(
      (connection) => connection.provider === provider,
    );
    const explicitAccounts = explicitSocialDestinations(
      input.message,
      forProvider,
    );

    // Respect an explicitly named project constraint before counting candidates.
    if (namedProjects.length > 0) {
      const outsideNamed = explicitAccounts.filter(
        (account) => !namedProjectIds.has(account.project.id),
      );
      if (outsideNamed.length > 0) {
        hints.push(
          `Core social records: the request names ${formatProjects(namedProjects)} alongside ${formatCapped(outsideNamed, socialDestinationLabel)} on a different project. Ask the owner once which project or account to use and make no social changes until they answer (ids are for tools; never show raw ids).`,
        );
        continue;
      }
      const inNamedProjects = forProvider.filter((connection) =>
        namedProjectIds.has(connection.project.id),
      );
      if (inNamedProjects.length === 0) {
        hints.push(
          `Core social records: ${formatProjects(namedProjects)} has 0 active ${label} accounts connected. Tell the owner no ${label} account is connected on the requested project, do not substitute another project, and make no social changes (ids are for tools; never show raw ids).`,
        );
        continue;
      }
      const narrowed =
        explicitAccounts.length > 0 ? explicitAccounts : inNamedProjects;
      if (narrowed.length === 1) {
        hints.push(
          `Core social records: exactly 1 fitting ${label} destination in scope — ${socialDestinationLabel(narrowed[0])}. If this request posts or schedules on ${label}, use this account and project directly without asking which project or account, and state which one you used in one line (ids are for tools; never show raw ids).`,
        );
      } else if (explicitAccounts.length >= 2) {
        hints.push(
          `Core social records: the request explicitly names ${explicitAccounts.length} active ${label} accounts — ${formatCapped(explicitAccounts, socialDestinationLabel)}. Use those named destinations directly without asking which project or account (ids are for tools; never show raw ids).`,
        );
      } else if (!input.hasOpenAccountQuestion) {
        hints.push(
          `Core social records: ${narrowed.length} active ${label} accounts in scope for ${formatProjects(namedProjects)} — ${formatCapped(narrowed, socialDestinationLabel)}. Ask the owner once which account (@handle) to use and make no changes until they answer (ids are for tools; never show raw ids).`,
        );
      }
      continue;
    }

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
    const explicitNewsletters = explicitNewslettersIn(
      input.message,
      newsletters,
    );
    if (namedProjects.length > 0) {
      const outsideNamed = explicitNewsletters.filter(
        (newsletter) => !namedProjectIds.has(newsletter.project.id),
      );
      if (outsideNamed.length > 0) {
        hints.push(
          `Core newsletter records: the request names ${formatProjects(namedProjects)} alongside newsletter(s) on a different project. Ask the owner once which project's newsletter to use and make no changes until they answer (ids are for tools; never show raw ids).`,
        );
      } else {
        const inNamedProjects = newsletters.filter((newsletter) =>
          namedProjectIds.has(newsletter.project.id),
        );
        if (inNamedProjects.length === 0) {
          hints.push(
            `Core newsletter records: ${formatProjects(namedProjects)} has 0 newsletters set up. Tell the owner no newsletter is set up on the requested project, do not substitute another project, and make no changes (ids are for tools; never show raw ids).`,
          );
        } else if (inNamedProjects.length === 1) {
          hints.push(
            `Core newsletter records: exactly 1 fitting newsletter in scope — "${inNamedProjects[0].name}" (Project "${inNamedProjects[0].project.name}", projectId ${inNamedProjects[0].project.id}). Use this project directly without asking which project, and state which one you used in one line (ids are for tools; never show raw ids).`,
          );
        } else {
          hints.push(
            `Core newsletter records: ${inNamedProjects.length} newsletters in scope for ${formatProjects(namedProjects)} — ${formatCapped(inNamedProjects, (n) => `"${n.name}" (Project "${n.project.name}", projectId ${n.project.id})`)}. Ask the owner once which to use and make no changes until they answer (ids are for tools; never show raw ids).`,
          );
        }
      }
    } else if (newsletters.length === 0) {
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
    } else if (namedProjects.length === 1) {
      hints.push(
        `Core project records: the request names 1 open project — Project "${namedProjects[0].name}" (projectId ${namedProjects[0].id}). Use it directly without asking which project or showing a project selector (ids are for tools; never show raw ids).`,
      );
    }
  }

  return hints;
}

/**
 * Checkable structural guard on `preview_result({ kind: "project_selection" })`
 * when `SokoBotVersion.askPolicy` is enabled. Refuses redundant selectors only
 * when Core's project records structurally rule out choosing among multiple
 * projects (single-project shared bot, 0/1 open projects in scope, or 0/1
 * open projects matched). When 2+ open projects exist and the picker's target
 * deliverable is not structurally constrained, leaves the picker available;
 * turn-start candidate hints guide the model and write-time checks enforce
 * social destinations.
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

  return null;
}
