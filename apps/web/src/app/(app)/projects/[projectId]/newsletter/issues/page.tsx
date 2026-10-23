import { notFound } from "next/navigation";
import type { SearchParams } from "nuqs/server";
import { z } from "zod";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { newsletterService } from "@/lib/services/newsletter.service";
import { Issues } from "./issues";
import { loadIssueSearchParams } from "./search-params";

export const instant = false;

export default async function NewsletterIssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  if (!(await newsletterService.isEnabled())) notFound();
  const { projectId } = await params;
  const query = await loadIssueSearchParams(searchParams);
  const cursor = z.uuid().safeParse(query.cursor);
  try {
    const [response, subscribers] = await Promise.all([
      newsletterService.listIssues(projectId, {
        limit: 25,
        ...(cursor.success ? { cursor: cursor.data } : {}),
      }),
      newsletterService.listSubscribers(projectId, {
        limit: 1,
        status: "ACTIVE",
      }),
    ]);
    return (
      <Issues
        projectId={projectId}
        issues={response.data}
        pagination={response.meta.pagination}
        activeSubscribers={subscribers.data.counts.ACTIVE}
      />
    );
  } catch (error) {
    if (error instanceof CoreApiRequestError && error.status === 404)
      notFound();
    throw error;
  }
}
