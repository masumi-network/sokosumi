import type { SearchParams } from "nuqs/server";

import { redirectToNewsletter } from "../../redirect-to-newsletter";

export const instant = false;

export default async function ProjectNewsletterIssueRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; issueId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { projectId, issueId } = await params;
  return redirectToNewsletter(
    `/newsletter/issues/${encodeURIComponent(issueId)}`,
    projectId,
    searchParams,
  );
}
