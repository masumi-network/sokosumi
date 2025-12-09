"use client";

import { JobStatus, type JobWithEvent } from "@sokosumi/database";
import { isPaidJob } from "@sokosumi/database/helpers";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import Markdown from "@/components/markdown";
import { Separator } from "@/components/ui/separator";
import { getResultHash } from "@/lib/utils";

import CopyMarkdown from "./copy-markdown";
import DownloadButton from "./download-button";
import { HashGroupRow } from "./hash-group-row";
import JobShareButton from "./job-share-button";
import MaximizeMarkdown from "./maximize-markdown";
import RequestRefundButton from "./refund-request";

interface JobDetailsOutputsProps {
  data: JobWithEvent;
  readOnly?: boolean;
  activeOrganizationId?: string | null;
}

interface JobDetailsOutputsLayoutProps {
  children: React.ReactNode;
}

function JobDetailsOutputsLayout({ children }: JobDetailsOutputsLayoutProps) {
  return <div className="flex flex-col gap-2">{children}</div>;
}

export default function JobDetailsOutputs({
  data,
  readOnly = false,
  activeOrganizationId,
}: JobDetailsOutputsProps) {
  return (
    <DefaultErrorBoundary fallback={<JobDetailsOutputsError />}>
      <JobDetailsOutputsInner
        data={data}
        readOnly={readOnly}
        activeOrganizationId={activeOrganizationId}
      />
    </DefaultErrorBoundary>
  );
}

function JobDetailsOutputsInner({
  data,
  readOnly,
  activeOrganizationId,
}: JobDetailsOutputsProps) {
  const { job, event } = data;
  const t = useTranslations("Components.Jobs.JobDetails.Output");
  const tMeta = useTranslations("Components.Jobs.JobDetails.Meta");
  const searchParams = useSearchParams();

  const result = event.result;

  const calculatedResultHash = useMemo(() => {
    if (!job.identifierFromPurchaser || !result) return null;
    return getResultHash(result, job.identifierFromPurchaser);
  }, [result, job.identifierFromPurchaser]);

  const onChainResultHash = job.purchase?.resultHash ?? null;
  const showHashSection =
    event.status === JobStatus.COMPLETED &&
    (onChainResultHash || calculatedResultHash);

  return (
    <JobDetailsOutputsLayout>
      {result ? (
        <>
          <Markdown highlightTerm={(searchParams?.get("query") ?? "").trim()}>
            {result}
          </Markdown>
          <div className="flex justify-between gap-2">
            <div className="flex gap-4">
              <MaximizeMarkdown markdown={result} />
              <div className="flex gap-1">
                <DownloadButton markdown={result} />
                <CopyMarkdown markdown={result} />
                {!readOnly && (
                  <JobShareButton
                    job={job}
                    activeOrganizationId={activeOrganizationId}
                  />
                )}
              </div>
            </div>
            {!readOnly && isPaidJob(job) && (
              <RequestRefundButton initialJob={job} />
            )}
          </div>
          {showHashSection && (
            <>
              <Separator className="my-2" />
              <HashGroupRow
                label={tMeta("resultHash")}
                direction="result"
                onChainHash={onChainResultHash}
                calculatedHash={calculatedResultHash}
                data={data}
                tLabelOnChain={tMeta("onChain")}
                tLabelCalculated={tMeta("calculated")}
                tMissing={tMeta("missing")}
              />
            </>
          )}
        </>
      ) : (
        <>
          <p className="text-base">{t("none")}</p>
          {event.status === JobStatus.FAILED && !readOnly && isPaidJob(job) && (
            <div className="flex justify-end">
              <RequestRefundButton initialJob={job} />
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
