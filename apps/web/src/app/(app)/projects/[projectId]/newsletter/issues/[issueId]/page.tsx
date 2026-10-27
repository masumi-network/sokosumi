import { notFound } from "next/navigation";
import { NewsletterIssueEditor } from "@/app/projects/[projectId]/newsletter/issues/issue-editor";
import { newsletterService } from "@/lib/services/newsletter.service";

export const instant = false;

export default async function NewsletterIssuePage({
  params,
}: {
  params: Promise<{ projectId: string; issueId: string }>;
}) {
  if (!(await newsletterService.isEnabled())) notFound();
  const { projectId, issueId } = await params;
  const issue = await newsletterService.getIssue(projectId, issueId);
  if (!issue) notFound();
  return (
    <NewsletterIssueEditor key={issue.id} issue={issue} projectId={projectId} />
  );
}
