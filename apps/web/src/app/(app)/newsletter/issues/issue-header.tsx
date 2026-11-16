import type { NewsletterIssue } from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { IssueStatusBadge, IssueWhen } from "./issue-delivery-status";

/**
 * Which issue this page is: its subject as the heading, its status, when it
 * went out (and to how many, once analytics are loaded), and its web copy.
 */
export function IssueHeader({
  issue,
  newsletterSlug,
  recipients,
}: {
  issue: NewsletterIssue;
  newsletterSlug: string;
  recipients?: number;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  return (
    <header className="min-w-0 space-y-3">
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="min-w-0 text-2xl font-semibold wrap-anywhere">
            {issue.subject}
          </h2>
          <IssueStatusBadge issue={issue} />
        </div>
        <IssueWhen issue={issue} recipients={recipients} />
      </div>
      {issue.status === "SENT" ? (
        <Button asChild variant="outline">
          <Link
            href={`/n/${encodeURIComponent(newsletterSlug)}/p/${encodeURIComponent(issue.publicSlug)}`}
          >
            {t("viewOnWeb")}
          </Link>
        </Button>
      ) : null}
    </header>
  );
}
