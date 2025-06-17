import { useTranslations } from "next-intl";
import { z } from "zod";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import { jobInputSchema } from "@/lib/job-input";
import { JsonValue } from "@/prisma/generated/client/runtime/library";

interface JobDetailsInputsProps {
  rawInput: string | null;
  inputSchema: JsonValue | null;
}

export default function JobDetailsInputs({
  rawInput,
  inputSchema,
}: JobDetailsInputsProps) {
  return (
    <DefaultErrorBoundary fallback={<JobDetailsInputsError />}>
      <JobDetailsInputsInner rawInput={rawInput} inputSchema={inputSchema} />
    </DefaultErrorBoundary>
  );
}

function JobDetailsInputsInner({
  rawInput,
  inputSchema,
}: JobDetailsInputsProps) {
  const t = useTranslations("App.Agents.Jobs.JobDetails.Input");
  const input = rawInput ? JSON.parse(rawInput) : {};

  let idNameMap: Record<string, string> = {};
  if (Array.isArray(inputSchema)) {
    idNameMap = z
      .array(jobInputSchema())
      .parse(inputSchema)
      .reduce(
        (acc, item) => {
          acc[item.id] = item.name;
          return acc;
        },
        {} as Record<string, string>,
      );
  }

  return (
    <div className="flex flex-col gap-2">
      {Object.keys(input).length > 0 ? (
        <div>
          {Object.entries(input).map(([key, value]) => (
            <div
              className="flex flex-row items-start gap-4 text-base"
              key={key}
            >
              <span className="font-bold">{idNameMap[key] || key}</span>
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
