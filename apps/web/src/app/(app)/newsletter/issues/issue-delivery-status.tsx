import type { NewsletterIssue } from "@sokosumi/core-client";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { newsletterHref } from "@/app/newsletter/newsletter-tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function IssueStatusBadge({ issue }: { issue: NewsletterIssue }) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  const partial = issue.status === "SENT" && Boolean(issue.lastError);
  return (
    <Badge
      variant={issue.status === "FAILED" ? "destructive" : "secondary"}
      className={cn(
        "max-w-full whitespace-normal wrap-anywhere",
        partial &&
          "border-transparent bg-semantic-warning-quaternary text-semantic-warning-label",
      )}
    >
      {partial
        ? t("Delivery.partial")
        : issue.status === "NEEDS_APPROVAL" &&
            issue.approvedAt &&
            issue.approvedByUserId
          ? t("Lifecycle.approved")
          : t(`statuses.${issue.status}`)}
    </Badge>
  );
}

export function IssueDeliveryOutcome({
  issue,
  projectId,
}: {
  issue: NewsletterIssue;
  projectId: string;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues.Delivery");
  if (issue.status === "SENDING") {
    return <p className="text-muted-foreground text-sm">{t("sending")}</p>;
  }
  const partial = issue.status === "SENT" && Boolean(issue.lastError);
  if (issue.status !== "FAILED" && !partial) return null;

  return (
    <div
      role="note"
      className="bg-card-background flex min-w-0 items-start gap-2 rounded-lg p-3 text-sm"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-2">
        <p>{t(partial ? "partialHelp" : "failedHelp")}</p>
        {issue.lastError ? (
          <p className="whitespace-pre-wrap wrap-anywhere">
            <span className="font-medium">{t("details")}</span>{" "}
            {issue.lastError}
          </p>
        ) : null}
        <Link
          className="inline-block py-1 underline underline-offset-4"
          href={newsletterHref("/newsletter/settings", projectId)}
        >
          {t("reviewSettings")}
        </Link>
      </div>
    </div>
  );
}
