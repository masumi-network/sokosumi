import type { NewsletterIssue } from "@sokosumi/core-client";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
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

/** Who approved the issue, when a sending issue was scheduled, and its approval Task: the facts behind the status badge. */
export function IssueStatusDetails({ issue }: { issue: NewsletterIssue }) {
  const t = useTranslations("App.Projects.Newsletter.Issues.Lifecycle");
  const format = useFormatter();
  const details = [
    issue.approvedAt && issue.approvedByUserId
      ? t("approvedBy", {
          user: issue.approvedByName ?? t("formerMember"),
          date: format.dateTime(issue.approvedAt, "dateTime"),
        })
      : null,
    issue.scheduledAt && issue.status === "SENDING"
      ? t("scheduled", {
          date: format.dateTime(issue.scheduledAt, "dateTime", {
            timeZone: issue.timezone ?? "UTC",
          }),
          timezone: issue.timezone ?? "UTC",
        })
      : null,
  ].filter(Boolean);
  if (!details.length && !issue.taskId) return null;
  return (
    <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {details.map((detail) => (
        <span key={detail}>{detail}</span>
      ))}
      {issue.taskId ? (
        <Link
          className="text-foreground underline underline-offset-4"
          href={`/tasks/${issue.taskId}`}
        >
          {t("task")}
        </Link>
      ) : null}
    </p>
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
