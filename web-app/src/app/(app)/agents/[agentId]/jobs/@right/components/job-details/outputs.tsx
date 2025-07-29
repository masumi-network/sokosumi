"use client";
import { useTranslations } from "next-intl";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import Markdown from "@/components/markdown";
import { JobWithStatus } from "@/lib/db";
import {
  jobStatusResponseSchema,
  JobStatusResponseSchemaType,
} from "@/lib/schemas";

import CopyMarkdown from "./copy-markdown";
import DownloadMarkdown from "./download-markdown";
import MaximizeMarkdown from "./maximize-markdown";
import RequestRefundButton from "./refund-request";

interface JobDetailsOutputsProps {
  job: JobWithStatus;
}

interface JobDetailsOutputsLayoutProps {
  children: React.ReactNode;
}

function JobDetailsOutputsLayout({ children }: JobDetailsOutputsLayoutProps) {
  return <div className="flex flex-col gap-2">{children}</div>;
}

export default function JobDetailsOutputs({ job }: JobDetailsOutputsProps) {
  return (
    <DefaultErrorBoundary fallback={<JobDetailsOutputsError />}>
      <JobDetailsOutputsInner job={job} />
    </DefaultErrorBoundary>
  );
}

function JobDetailsOutputsInner({ job }: JobDetailsOutputsProps) {
  const t = useTranslations("App.Agents.Jobs.JobDetails.Output");

  if (!job.output) {
    return (
      <JobDetailsOutputsLayout>
        <p className="text-base">{t("none")}</p>
      </JobDetailsOutputsLayout>
    );
  }

  let output: JobStatusResponseSchemaType;
  try {
    const parsedOutput = JSON.parse(job.output);
    output = jobStatusResponseSchema.parse(parsedOutput);
  } catch {
    return <JobDetailsOutputsError />;
  }

  return (
    <JobDetailsOutputsLayout>
      {output.result ? (
        <>
          <Markdown>{output.result}</Markdown>
          <div className="flex justify-between gap-2">
            <div className="flex gap-4">
              <MaximizeMarkdown markdown={output.result} />
              <div className="flex gap-1">
                <DownloadMarkdown markdown={output.result} />
                <CopyMarkdown markdown={output.result} />
              </div>
            </div>
            <RequestRefundButton job={job} />
          </div>
        </>
      ) : (
        <p className="text-base">{t("none")}</p>
      )}
    </JobDetailsOutputsLayout>
  );
}

function JobDetailsOutputsError() {
  const t = useTranslations("App.Agents.Jobs.JobDetails.Output");

  return (
    <div className="flex min-h-[120px] w-full items-center justify-center rounded-md border border-red-300 bg-red-50 p-4">
      <span className="text-lg text-red-500">{t("failedToParseOutput")}</span>
    </div>
  );
}
