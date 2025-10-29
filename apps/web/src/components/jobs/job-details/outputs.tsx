"use client";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import Markdown from "@/components/markdown";
import { isPaidJob, JobStatus, JobWithStatus } from "@/lib/db";
import {
  jobStatusResponseSchema,
  JobStatusResponseSchemaType,
} from "@/lib/schemas";

import CopyMarkdown from "./copy-markdown";
import DownloadButton from "./download-button";
import JobShareButton from "./job-share-button";
import MaximizeMarkdown from "./maximize-markdown";
import RequestRefundButton from "./refund-request";

interface JobDetailsOutputsProps {
  job: JobWithStatus;
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
  job,
  readOnly = false,
  activeOrganizationId,
}: JobDetailsOutputsProps) {
  return (
    <DefaultErrorBoundary fallback={<JobDetailsOutputsError />}>
      <JobDetailsOutputsInner
        job={job}
        readOnly={readOnly}
        activeOrganizationId={activeOrganizationId}
      />
    </DefaultErrorBoundary>
  );
}

function JobDetailsOutputsInner({
  job,
  readOnly,
  activeOrganizationId,
}: JobDetailsOutputsProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Output");
  const searchParams = useSearchParams();

  let output: JobStatusResponseSchemaType | null = null;
  if (job.output) {
    try {
      const parsedOutput = JSON.parse(job.output);
      output = jobStatusResponseSchema.parse(parsedOutput);
    } catch {
      return <JobDetailsOutputsError />;
    }
  }

  return (
    <JobDetailsOutputsLayout>
      {output?.result ? (
        <>
          <Markdown highlightTerm={(searchParams?.get("query") ?? "").trim()}>
            {output.result}
          </Markdown>
          <div className="flex justify-between gap-2">
            <div className="flex gap-4">
              <MaximizeMarkdown markdown={output.result} />
              <div className="flex gap-1">
                <DownloadButton markdown={output.result} />
                <CopyMarkdown markdown={output.result} />
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
        </>
      ) : (
        <>
          <p className="text-base">{t("none")}</p>
          {job.status === JobStatus.FAILED && !readOnly && isPaidJob(job) && (
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
