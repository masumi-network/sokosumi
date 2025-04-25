import { useTranslations } from "next-intl";

import DefaultErrorBoundary from "@/components/default-error-boundary";

interface JobDetailsInputsProps {
  rawInput: string | null;
}

export default function JobDetailsInputs({ rawInput }: JobDetailsInputsProps) {
  return (
    <DefaultErrorBoundary fallback={<JobDetailsInputsError />}>
      <JobDetailsInputsInner rawInput={rawInput} />
    </DefaultErrorBoundary>
  );
}

function JobDetailsInputsInner({ rawInput }: JobDetailsInputsProps) {
  const t = useTranslations("App.Agents.Jobs.JobDetails.Input");
  const input = rawInput ? JSON.parse(rawInput) : {};

  return (
    <div className="flex flex-col gap-2">
      {Object.keys(input).length > 0 ? (
        <div>
          {Object.entries(input).map(([key, value]) => (
            <div
              className="flex flex-row items-start gap-4 text-base"
              key={key}
            >
              <span className="font-bold">{key}</span>
              <span className="break-words">
                {typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-base">{t("none")}</p>
      )}
    </div>
  );
}

function JobDetailsInputsError() {
  const t = useTranslations("App.Agents.Jobs.JobDetails.Input");

  return (
    <div className="flex min-h-[120px] w-full items-center justify-center rounded-md border border-red-300 bg-red-50 p-4">
      <span className="text-lg text-red-500">{t("failedToParseInput")}</span>
    </div>
  );
}
