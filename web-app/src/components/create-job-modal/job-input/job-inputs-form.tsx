"use client";

import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import useAgentInputSchema from "@/hooks/use-agent-input-schema";
import { AgentDemoData, AgentLegal, CreditsPrice } from "@/lib/db";
import { getDemoValues, JobInputsDataSchemaType } from "@/lib/job-input";

import JobInputsFormClient, { DemoValues } from "./job-inputs-form.client";

interface JobInputsFormProps {
  agentId: string;
  agentCreditsPrice: CreditsPrice;
  averageExecutionDuration: number;
  demoData?: AgentDemoData | null;
  legal?: AgentLegal | null | undefined;
  className?: string | undefined;
}

interface JobInputsFormInnerProps extends JobInputsFormProps {
  inputSchema: JobInputsDataSchemaType;
  demoValues: DemoValues | null;
}

export default function JobInputsForm({
  agentId,
  agentCreditsPrice,
  averageExecutionDuration,
  demoData,
  legal,
  className,
}: JobInputsFormProps) {
  const { data: inputSchema, loading, error } = useAgentInputSchema(agentId);

  if (loading) {
    return <JobInputsFormSkeleton />;
  }

  if (error || !inputSchema) {
    return <JobInputsFormError />;
  }

  // check demo data is valid
  let demoValues: DemoValues | null = null;
  if (demoData) {
    demoValues = getDemoValues(inputSchema.input_data, demoData);
    if (!demoValues) {
      return <JobInputsFormDemoError />;
    }
  }

  return (
    <JobInputsFormInner
      agentId={agentId}
      agentCreditsPrice={agentCreditsPrice}
      averageExecutionDuration={averageExecutionDuration}
      demoValues={demoValues}
      inputSchema={inputSchema}
      legal={legal}
      className={className}
    />
  );
}

function JobInputsFormInner({
  agentId,
  agentCreditsPrice,
  averageExecutionDuration,
  demoValues,
  inputSchema,
  legal,
  className,
}: JobInputsFormInnerProps) {
  return (
    <JobInputsFormClient
      agentId={agentId}
      agentCreditsPrice={agentCreditsPrice}
      averageExecutionDuration={averageExecutionDuration}
      jobInputsDataSchema={inputSchema}
      demoValues={demoValues}
      legal={legal}
      className={className}
    />
  );
}

export function JobInputsFormSkeleton() {
  return (
    <div className="flex w-full flex-col gap-2">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
      </div>
    </div>
  );
}

function JobInputsFormError() {
  const t = useTranslations("Library.JobInput.Error");

  return (
    <div className="flex min-h-[120px] w-full items-center justify-center rounded-md border border-red-300 bg-red-50 p-4">
      <span className="text-lg text-red-500">
        {t("failedToFetchJobInputSchema")}
      </span>
    </div>
  );
}

function JobInputsFormDemoError() {
  const t = useTranslations("Library.JobInput.Error");

  return (
    <div className="flex min-h-[120px] w-full items-center justify-center rounded-md border border-red-300 bg-red-50 p-4">
      <span className="text-lg text-red-500">{t("demoDataInvalid")}</span>
    </div>
  );
}
