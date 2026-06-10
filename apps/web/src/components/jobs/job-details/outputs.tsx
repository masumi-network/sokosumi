"use client";

import {
  AgentJobStatus,
  type JobEventWithRelations,
  type JobWithSokosumiStatus,
} from "@sokosumi/database";
import { hashResult } from "@sokosumi/masumi/hash";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import { ExpandableMarkdown } from "@/components/expandable-markdown";
import { Separator } from "@/components/ui/separator";

import CopyMarkdown from "./copy-markdown";
import DownloadButton from "./download-button";
import { HashGroupRow } from "./hash-group-row";
import MaximizeMarkdown from "./maximize-markdown";
import RequestRefundButton, { canRenderRefundRequest } from "./refund-request";

interface JobDetailsOutputsProps {
  job: JobWithSokosumiStatus;
  event: JobEventWithRelations;
  readOnly?: boolean;
}

interface JobDetailsOutputsLayoutProps {
  children: React.ReactNode;
}

function JobDetailsOutputsLayout({ children }: JobDetailsOutputsLayoutProps) {
  return <div className="flex flex-col gap-2">{children}</div>;
}

export default function JobDetailsOutputs({
  job,
  event,
  readOnly = false,
}: JobDetailsOutputsProps) {
  return (
    <DefaultErrorBoundary fallback={<JobDetailsOutputsError />}>
      <JobDetailsOutputsInner job={job} event={event} readOnly={readOnly} />
    </DefaultErrorBoundary>
  );
}

function JobDetailsOutputsInner({
  job,
  event,
  readOnly,
}: JobDetailsOutputsProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Output");
  const tMeta = useTranslations("Components.Jobs.JobDetails.Meta");
  const searchParams = useSearchParams();

  const result = event.result;

  const calculatedResultHash = useMemo(() => {
    if (!job.identifierFromPurchaser || !result) return null;
    return hashResult(result, job.identifierFromPurchaser);
  }, [result, job.identifierFromPurchaser]);

  const onChainResultHash = job.resultHash ?? null;
  const isCompleted = event.status === AgentJobStatus.COMPLETED;
  const highlightTerm = (searchParams?.get("query") ?? "").trim();
  const refundJob = !readOnly && canRenderRefundRequest(job) ? job : null;

  return (
    <JobDetailsOutputsLayout>
      {result ? (
        <div className="min-h-0 overflow-hidden">
          <ExpandableMarkdown
            content={result}
            className="text-foreground/80"
            highlightTerm={highlightTerm}
            expandLabel={t("expand")}
            collapseLabel={t("collapse")}
            fadeClassName="to-transparent"
          />
          {isCompleted && (
            <>
              <div className="flex justify-between gap-2">
                <div className="flex gap-4">
                  <MaximizeMarkdown markdown={result} />
                  <div className="flex gap-1">
                    <DownloadButton markdown={result} />
                    <CopyMarkdown markdown={result} />
                  </div>
                </div>
                {refundJob && <RequestRefundButton initialJob={refundJob} />}
              </div>
              <Separator className="my-2" />
              <HashGroupRow
                label={tMeta("resultHash")}
                direction="result"
                jobType={job.jobType}
                onChainStatus={job.onChainStatus}
                identifierFromPurchaser={job.identifierFromPurchaser}
                result={result}
                externalHash={onChainResultHash}
                hash={calculatedResultHash}
                tLabelExternal={tMeta("onChain")}
                tLabelHash={tMeta("calculated")}
                tMissing={tMeta("missing")}
              />
            </>
          )}
        </div>
      ) : (
        <>
          <p className="text-base">{t("none")}</p>
          {event.status === AgentJobStatus.FAILED && refundJob && (
            <div className="flex justify-end">
              <RequestRefundButton initialJob={refundJob} />
            </div>
          )}
        </>
      )}
    </JobDetailsOutputsLayout>
  );
}

function JobDetailsOutputsError() {
  const t = useTranslations("Components.Jobs.JobDetails.Output");

  return (
    <div className="border-semantic-destructive bg-semantic-destructive/10 flex min-h-[120px] w-full items-center justify-center rounded-md border p-4">
      <span className="text-semantic-destructive text-lg">
        {t("failedToParseResult")}
      </span>
    </div>
  );
}
