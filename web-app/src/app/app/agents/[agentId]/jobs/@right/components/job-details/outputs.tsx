import Markdown from "markdown-to-jsx";
import { useTranslations } from "next-intl";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import {
  jobStatusResponseSchema,
  JobStatusResponseSchemaType,
} from "@/lib/services/job/schemas";

interface JobDetailsOutputsProps {
  rawOutput: string | null;
}

interface JobDetailsOutputsLayoutProps {
  children: React.ReactNode;
}

function JobDetailsOutputsLayout({ children }: JobDetailsOutputsLayoutProps) {
  return <div className="flex flex-col gap-2">{children}</div>;
}

export default function JobDetailsOutputs({
  rawOutput,
}: JobDetailsOutputsProps) {
  return (
    <DefaultErrorBoundary fallback={<JobDetailsOutputsError />}>
      <JobDetailsOutputsInner rawOutput={rawOutput} />
    </DefaultErrorBoundary>
  );
}

function JobDetailsOutputsInner({ rawOutput }: JobDetailsOutputsProps) {
  const t = useTranslations("App.Agents.Jobs.JobDetails.Output");

  if (!rawOutput) {
    return (
      <JobDetailsOutputsLayout>
        <p className="text-base">{t("none")}</p>
      </JobDetailsOutputsLayout>
    );
  }

  let output: JobStatusResponseSchemaType;
  try {
    const parsedOutput = JSON.parse(rawOutput);
    output = jobStatusResponseSchema.parse(parsedOutput);
  } catch {
    return <JobDetailsOutputsError />;
  }

  return (
    <JobDetailsOutputsLayout>
      {output.result ? (
        <Markdown
          options={{
            disableParsingRawHTML: true,
            wrapper: ({ children }) => (
              <div className="markdown-body">{children}</div>
            ),
            forceWrapper: true,
          }}
        >
          {output.result}
        </Markdown>
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
