import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { SearchParams } from "nuqs/server";

import { loadCampaignDetailsSearchParams } from "@/app/ads/ads-query";
import { adsService } from "@/lib/services/ads.service";
import { projectService } from "@/lib/services/project.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";

/**
 * What a Google campaign's page (details or edit) starts from, behind the
 * Social beta. The account comes from `?accountId=`, and these pages are only
 * linked from a list that showed the project and the account, so anything that
 * is not there is a 404: a lost project or account, or a Meta account.
 */
export async function loadGoogleCampaignPage(
  params: Promise<{ campaignId: string }>,
  searchParams: Promise<SearchParams>,
) {
  await connection();
  if (!(await hasCurrentUserSocialBetaAccess())) {
    notFound();
  }

  const { campaignId } = await params;
  const query = await loadCampaignDetailsSearchParams(searchParams);
  const projectId = query.projectId?.trim();
  const project = projectId
    ? await projectService.getProjectById(projectId)
    : null;
  if (!project) {
    notFound();
  }

  const accounts = await adsService.listAccounts(project.id);
  const account = accounts.find(({ id }) => id === query.accountId);
  if (!account || account.provider !== "google_ads") {
    notFound();
  }

  return { campaignId, query, project, account };
}
