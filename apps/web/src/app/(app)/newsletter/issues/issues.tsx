"use client";

import {
  type NewsletterIssue,
  NewsletterIssueStatus,
  type PaginationMetadata,
} from "@sokosumi/core-client";
import { Mail, Plus } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryStates } from "nuqs";
import { useRef, useState, useTransition } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { newsletterHref } from "../newsletter-tabs";
import { DraftIssueButton } from "./draft-issue-dialog";
import { IssueDeleteButton } from "./issue-delete-button";
import {
  IssueDeliveryOutcome,
  IssueStatusBadge,
} from "./issue-delivery-status";
import { NewIssueDialog } from "./new-issue-dialog";
import { issueSearchParams } from "./search-params";

export function Issues({
  projectId,
  issues,
  pagination,
  activeSubscribers,
}: {
  projectId: string;
  issues: NewsletterIssue[];
  pagination: PaginationMetadata;
  activeSubscribers: number;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  const format = useFormatter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const [pending, startTransition] = useTransition();
  const [pendingPage, setPendingPage] = useState<"first" | "next" | null>(null);
  const [, setQuery] = useQueryStates(issueSearchParams, {
    shallow: false,
    startTransition,
  });
  const newIssue = (
    <div className="flex flex-wrap justify-center gap-2">
      <DraftIssueButton projectId={projectId} />
      <Button
        ref={newButton}
        variant="primary"
        onClick={() => setDialogOpen(true)}
      >
        <Plus />
        {t("newIssue")}
      </Button>
    </div>
  );
  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{t("title")}</h3>
          <Link
            className="text-muted-foreground inline-block py-1 text-sm underline underline-offset-4"
            href={newsletterHref("/newsletter/subscribers", projectId)}
          >
            {t("Readiness.audienceCount", { count: activeSubscribers })}
          </Link>
        </div>
        {issues.length ? newIssue : null}
      </div>
      {!issues.length ? (
        <div className={HOLDER_CLASS}>
          <EmptyState
            icon={Mail}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
            action={newIssue}
          />
        </div>
      ) : (
        <ul
          aria-label={t("title")}
          aria-busy={pending}
          className={cn(HOLDER_CLASS, "min-w-0 space-y-2")}
        >
          {issues.map((issue) => {
            const href = newsletterHref(
              `/newsletter/issues/${encodeURIComponent(issue.id)}`,
              projectId,
            );
            const nextAction =
              issue.status === "NEEDS_APPROVAL" &&
              issue.approvedAt &&
              issue.approvedByUserId
                ? "APPROVED"
                : issue.status;
            return (
              <li
                key={issue.id}
                className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-3 p-4")}
              >
                <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
                  <div className="min-w-0 space-y-2">
                    <h4 className="text-base font-medium wrap-anywhere">
                      <Link
                        href={href}
                        className="underline-offset-4 hover:underline"
                      >
                        {issue.subject}
                      </Link>
                    </h4>
                    <IssueStatusBadge issue={issue} />
                    <p className="text-muted-foreground text-sm wrap-anywhere">
                      {issue.sentAt
                        ? t("sentAt", {
                            date: format.dateTime(issue.sentAt, "dateTime"),
                          })
                        : issue.scheduledAt
                          ? t("Lifecycle.scheduled", {
                              date: format.dateTime(
                                issue.scheduledAt,
                                "dateTime",
                                {
                                  timeZone: issue.timezone ?? "UTC",
                                },
                              ),
                              timezone: issue.timezone ?? "UTC",
                            })
                          : t("updated", {
                              date: format.dateTime(
                                issue.updatedAt,
                                "dateTime",
                              ),
                            })}
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
                    <Button
                      asChild
                      variant="outline"
                      className="h-auto min-h-10 max-w-full py-2 whitespace-normal"
                    >
                      <Link href={href}>{t(`nextActions.${nextAction}`)}</Link>
                    </Button>
                    {issue.status === NewsletterIssueStatus.DRAFT ? (
                      <IssueDeleteButton projectId={projectId} issue={issue} />
                    ) : null}
                  </div>
                </div>
                <IssueDeliveryOutcome issue={issue} projectId={projectId} />
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-muted-foreground text-sm tabular-nums">
          {t("results", { count: pagination.total })}
        </p>
        {pagination.cursor || pagination.nextCursor ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!pagination.cursor || pending}
              loading={pending && pendingPage === "first"}
              onClick={() => {
                setPendingPage("first");
                void setQuery({ cursor: null });
              }}
            >
              {t("firstPage")}
            </Button>
            <Button
              variant="outline"
              disabled={!pagination.nextCursor || pending}
              loading={pending && pendingPage === "next"}
              onClick={() => {
                setPendingPage("next");
                void setQuery({ cursor: pagination.nextCursor });
              }}
            >
              {t("nextPage")}
            </Button>
          </div>
        ) : null}
      </div>
      {dialogOpen ? (
        <NewIssueDialog
          projectId={projectId}
          onClose={() => setDialogOpen(false)}
          onCloseAutoFocus={() => newButton.current?.focus()}
        />
      ) : null}
    </section>
  );
}
