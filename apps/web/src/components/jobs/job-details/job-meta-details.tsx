"use client";

import { LinkIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { CopyableValue } from "@/components/copyable-value";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { MiddleTruncate } from "@/components/middle-truncate";
import { getEnvPublicConfig } from "@/config/env.public";
import type { Job } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";
import { buildJobTransactionUrl } from "@/lib/utils/url";

export interface JobMetaDetailsProps {
  job: Job;
  projectName?: string | null;
}

export function JobMetaDetails({ job, projectName }: JobMetaDetailsProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Meta");
  const formatter = useFormatter();
  const isMainnet = getEnvPublicConfig().NEXT_PUBLIC_NETWORK === "Mainnet";
  const taskHref = job.taskId ? `/tasks/${job.taskId}` : null;
  const dateTimeOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  } as const;

  return (
    <div className="space-y-4">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        {t("propertiesTitle")}
      </h3>

      <div className="space-y-3">
        <KeyValueRow label={t("status")}>
          <JobStatusBadge
            status={job.status}
            jobType={job.jobType}
            className="text-xs"
          />
        </KeyValueRow>

        {taskHref ? (
          <KeyValueRow label={t("task")}>
            <Link
              href={taskHref}
              className="hover:text-foreground text-sm font-medium underline-offset-2 hover:underline"
            >
              {t("openTask")}
            </Link>
          </KeyValueRow>
        ) : null}

        {projectName ? (
          <KeyValueRow label={t("project")}>
            <Link
              href={`/projects/${job.projectId}`}
              className="hover:text-foreground text-sm font-medium underline-offset-2 hover:underline"
            >
              {projectName}
            </Link>
          </KeyValueRow>
        ) : null}

        {job.credits > 0 ? (
          <KeyValueRow label={t("credits")}>
            <span className="text-muted-foreground text-sm">
              {formatCreditsForDisplay(job.credits)}
            </span>
          </KeyValueRow>
        ) : null}

        <div className="border-border/50 my-3 border-t" />

        <KeyValueRow label={t("started")}>
          <span className="text-muted-foreground text-sm whitespace-nowrap tabular-nums">
            {formatter.dateTime(job.createdAt, dateTimeOptions)}
          </span>
        </KeyValueRow>

        <KeyValueRow label={t("finished")}>
          <span className="text-muted-foreground text-sm whitespace-nowrap tabular-nums">
            {job.completedAt
              ? formatter.dateTime(job.completedAt, dateTimeOptions)
              : "—"}
          </span>
        </KeyValueRow>

        <div className="border-border/50 my-3 border-t" />

        <KeyValueRow label={t("jobId")} layout="column">
          <div className="w-full text-left text-sm">
            <CopyableValue value={job.agentJobId} />
          </div>
        </KeyValueRow>

        <KeyValueRow label={t("txId")} layout="column">
          <div className="w-full text-sm">
            {job.onChainTransactionHash ? (
              <Link
                href={buildJobTransactionUrl(
                  job.onChainTransactionHash,
                  isMainnet,
                )}
                className="hover:text-foreground inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                <LinkIcon className="size-4" />
                <MiddleTruncate text={job.onChainTransactionHash} />
              </Link>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        </KeyValueRow>
      </div>
    </div>
  );
}

function KeyValueRow({
  label,
  children,
  layout = "row",
}: {
  label: string;
  children: ReactNode;
  layout?: "row" | "column";
}) {
  if (layout === "column") {
    return (
      <div className="flex flex-col items-start justify-start gap-1.5">
        <span className="text-muted-foreground text-sm">{label}</span>
        <div className={cn("w-full text-left")}>{children}</div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground text-sm">{label}</span>
      <div className={cn("text-right")}>{children}</div>
    </div>
  );
}

export default JobMetaDetails;
