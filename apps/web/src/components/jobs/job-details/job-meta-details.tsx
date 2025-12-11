"use client";

import { JobWithSokosumiStatus } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";
import { LinkIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, ReactNode } from "react";

import { CopyableValue } from "@/components/copyable-value";
import { MiddleTruncate } from "@/components/middle-truncate";
import { Separator } from "@/components/ui/separator";
import { getEnvPublicConfig } from "@/config/env.public";
import { cn } from "@/lib/utils";
import { formatDateTimeMedium } from "@/lib/utils/format";
import { buildJobTransactionUrl } from "@/lib/utils/url";

export interface JobMetaDetailsProps {
  job: JobWithSokosumiStatus;
}

export function JobMetaDetails({ job }: JobMetaDetailsProps) {
  const isMainnet = getEnvPublicConfig().NEXT_PUBLIC_NETWORK === "Mainnet";

  const formatter = useFormatter();
  const t = useTranslations("Components.Jobs.JobDetails.Meta");

  const items = [
    {
      key: "jobId",
      label: t("jobId"),
      rowClassName: "pb-1",
      content: <CopyableValue value={job.agentJobId} />,
    },
    {
      key: "txId",
      label: t("txId"),
      rowClassName: "pb-1",
      content: job.purchase?.onChainTransactionHash ? (
        <Link
          href={buildJobTransactionUrl(
            job.purchase.onChainTransactionHash,
            isMainnet,
          )}
          className={"flex items-center gap-1 text-sm md:text-base"}
          target="_blank"
        >
          <LinkIcon className="size-4" />
          <MiddleTruncate text={job.purchase.onChainTransactionHash} />
        </Link>
      ) : (
        <span>{"-"}</span>
      ),
    },
    {
      key: "started",
      label: t("started"),
      rowClassName: "pb-1",
      content: formatDateTimeMedium(formatter.dateTime, job.createdAt),
    },
    {
      key: "finished",
      label: t("finished"),
      rowClassName: "pb-1",
      content: job.completedAt
        ? formatDateTimeMedium(formatter.dateTime, job.completedAt)
        : "-",
    },
    ...(job.creditTransaction
      ? [
          {
            key: "credits",
            label: t("credits"),
            rowClassName: "",
            content: Math.abs(
              convertCentsToCredits(job.creditTransaction.amount),
            ),
          },
        ]
      : []),
  ] as const;

  return (
    <div className="pt-6">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          <KeyValueRow label={item.label} rowClassName={item.rowClassName}>
            {item.content}
          </KeyValueRow>
          {index < items.length - 1 && <Separator className="my-2" />}
        </Fragment>
      ))}
    </div>
  );
}

function KeyValueRow({
  label,
  children,
  rowClassName = "",
}: {
  label: string;
  children: ReactNode;
  rowClassName?: string;
}) {
  return (
    <div
      className={cn(
        `grid h-9 grid-cols-2 items-center gap-4 text-base md:grid-cols-3`,
        rowClassName,
      )}
    >
      <span className="font-bold break-all md:col-span-1">{label}</span>
      <div className="break-all md:col-span-2">{children}</div>
    </div>
  );
}

export default JobMetaDetails;
