import type { TaskSeoAudit } from "@sokosumi/core-client";
import { SearchCheck } from "lucide-react";
import Link from "next/link";
import { seoTaskResultLink } from "@/app/seo/seo-href";
import { stripInlineMarkdown } from "@/lib/utils/strip-markdown";

import { BackToTasksButton } from "./back-to-tasks-button";
import { TaskIdentifierCopy } from "./task-identifier-copy";
import { TaskTitleHeading } from "./task-title-heading";

interface TaskDetailHeaderProps {
  taskId: string;
  taskName: string;
  /** Short id such as SOK-12; hidden for tasks without a project. */
  identifier?: string | null;
  identifierLabels?: {
    copy: string;
    copied: string;
    copyError: string;
  };
  backLabel: string;
  /** Back label when the task was opened from the Calendar. */
  calendarBackLabel?: string;
  /** False where the board is not the likely next page. */
  loadBoardOnMount?: boolean;
  parentLink?: React.ReactNode;
  /** The SEO page of an SEO analysis Task, from Core; null hides the link. */
  seoAudit?: TaskSeoAudit | null;
  seoAuditLabels?: { audit: string; project: string };
  actions?: React.ReactNode;
}

export function TaskDetailHeader({
  taskId,
  taskName,
  identifier,
  identifierLabels,
  backLabel,
  calendarBackLabel,
  loadBoardOnMount,
  parentLink,
  seoAudit,
  seoAuditLabels,
  actions,
}: TaskDetailHeaderProps) {
  const seoResult = seoAuditLabels ? seoTaskResultLink(seoAudit) : null;
  const seoLink =
    seoResult && seoAuditLabels
      ? { href: seoResult.href, label: seoAuditLabels[seoResult.kind] }
      : null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end md:justify-between">
        <BackToTasksButton
          label={backLabel}
          calendarLabel={calendarBackLabel}
          loadOnMount={loadBoardOnMount}
        />

        {actions}
      </div>

      <div className="space-y-1">
        {identifier && identifierLabels ? (
          <TaskIdentifierCopy
            identifier={identifier}
            copyAriaLabelPrefix={identifierLabels.copy}
            copiedMessage={identifierLabels.copied}
            copyErrorMessage={identifierLabels.copyError}
          />
        ) : null}
        <TaskTitleHeading
          taskId={taskId}
          title={stripInlineMarkdown(taskName)}
        />
      </div>
      {parentLink}
      {seoLink ? (
        <Link
          href={seoLink.href}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm underline-offset-4 transition-colors hover:underline"
        >
          <SearchCheck aria-hidden className="size-4" />
          {seoLink.label}
        </Link>
      ) : null}
    </div>
  );
}
