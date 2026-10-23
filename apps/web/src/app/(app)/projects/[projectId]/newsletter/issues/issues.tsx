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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DraftIssueButton } from "./draft-issue-dialog";
import { IssueActions } from "./issue-actions";
import { IssueDeleteButton } from "./issue-delete-button";
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
        <h3 className="text-base font-semibold">{t("title")}</h3>
        {issues.length ? newIssue : null}
      </div>
      {!issues.length ? (
        <EmptyState
          icon={Mail}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={newIssue}
        />
      ) : (
        <Table aria-label={t("title")} aria-busy={pending}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("subject")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("deliveryDate")}</TableHead>
              <TableHead>{t("updatedAt")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.map((issue) => (
              <TableRow key={issue.id}>
                <TableCell className="min-w-44 whitespace-normal">
                  <Link
                    href={`/projects/${projectId}/newsletter/issues/${issue.id}`}
                    className="font-medium break-words underline-offset-4 hover:underline"
                  >
                    {issue.subject}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      issue.status === NewsletterIssueStatus.FAILED
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {issue.approvedAt && issue.status === "NEEDS_APPROVAL"
                      ? t("Lifecycle.approved")
                      : t(`statuses.${issue.status}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {issue.sentAt
                    ? t("sentAt", {
                        date: format.dateTime(issue.sentAt, "dateTime"),
                      })
                    : issue.scheduledAt
                      ? t("scheduledAt", {
                          date: format.dateTime(issue.scheduledAt, "dateTime"),
                        })
                      : t("noDate")}
                </TableCell>
                <TableCell>
                  {format.dateTime(issue.updatedAt, "dateTime")}
                </TableCell>
                <TableCell>
                  <div className="space-y-2">
                    <IssueActions
                      issue={issue}
                      projectId={projectId}
                      activeSubscribers={activeSubscribers}
                    />
                    {issue.status === NewsletterIssueStatus.DRAFT ? (
                      <IssueDeleteButton projectId={projectId} issue={issue} />
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
