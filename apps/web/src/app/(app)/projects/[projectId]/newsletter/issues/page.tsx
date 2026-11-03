import type { SearchParams } from "nuqs/server";

import { redirectToNewsletter } from "../redirect-to-newsletter";

export const instant = false;

export default async function ProjectNewsletterIssuesRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { projectId } = await params;
  return redirectToNewsletter("/newsletter/issues", projectId, searchParams);
}
