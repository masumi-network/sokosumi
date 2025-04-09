import Markdown from "markdown-to-jsx";
import { useTranslations } from "next-intl";

import DefaultErrorBoundary from "@/components/default-error-boundary";

interface JobDetailsOutputsProps {
  rawOutput: string | null;
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
  const result = rawOutput ? JSON.parse(rawOutput) : null;
  const output = result?.result?.raw.toString();

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-bold">{t("title")}</h1>
      {output ? (
        <Markdown
          options={{
            disableParsingRawHTML: true,
            wrapper: ({ children }) => (
              <div className="markdown-body">{children}</div>
            ),
            forceWrapper: true,
          }}
        >
          {output}
        </Markdown>
      ) : (
        <p className="text-base">{t("none")}</p>
      )}
    </div>
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
