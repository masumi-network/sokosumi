import "server-only";

import type { ProjectAdAccount } from "@sokosumi/core-client";
import { adsService } from "@/lib/services/ads.service";
import { projectService } from "@/lib/services/project.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";

export interface BotAdAccount {
  projectId: string;
  projectName: string;
  account: ProjectAdAccount;
}

/** One page of Projects is plenty for a settings summary. */
const PROJECTS_SHOWN = 50;

/**
 * The Project ad accounts a Soko Bot works with through Core's ad tools: its
 * own Project's for a shared bot, every workspace Project's for a personal
 * one. `null` without the Social beta, so settings say nothing about ads. A
 * Project whose accounts cannot be read is left out rather than failing the
 * page.
 */
export async function loadBotAdAccounts({
  projectId,
}: {
  projectId: string | null;
}): Promise<BotAdAccount[] | null> {
  if (!(await hasCurrentUserSocialBetaAccess())) return null;

  const projects = projectId
    ? [await projectService.getProjectById(projectId)].filter(
        (project) => project !== null,
      )
    : (await projectService.listProjects({ limit: PROJECTS_SHOWN })).projects;

  const perProject = await Promise.all(
    projects.map(async ({ id, name }) =>
      (await adsService.listAccounts(id).catch(() => [])).map((account) => ({
        projectId: id,
        projectName: name,
        account,
      })),
    ),
  );
  return perProject.flat();
}
