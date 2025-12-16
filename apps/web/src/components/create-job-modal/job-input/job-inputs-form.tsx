"use client";

import { AgentWithCreditsPrice } from "@sokosumi/database";
import { InputDataSchemaType } from "@sokosumi/masumi/schemas";
import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import useAgentInputSchema from "@/hooks/use-agent-input-schema";
import { getAgentDemoValues, getAgentLegal } from "@/lib/helpers/agent";
import { AgentDemoValues } from "@/lib/types/agent";

import JobInputsFormClient from "./job-inputs-form.client";

interface JobInputsFormProps {
  agent: AgentWithCreditsPrice;
  averageExecutionDuration: number;
  isDemo: boolean;
  className?: string | undefined;
}

interface JobInputsFormInnerProps extends Omit<JobInputsFormProps, "isDemo"> {
  inputDataSchema: InputDataSchemaType;
  demoValues: AgentDemoValues | null;
}

export default function JobInputsForm({
  agent,
  averageExecutionDuration,
  isDemo,
  className,
}: JobInputsFormProps) {
  const {
    data: inputDataSchema,
    loading,
    error,
  } = useAgentInputSchema(agent.id);

  if (loading) {
    return <JobInputsFormSkeleton />;
  }

  if (error || !inputDataSchema) {
    return <JobInputsFormError />;
  }

  // check demo data is valid
  let demoValues: AgentDemoValues | null = null;
  if (isDemo) {
    demoValues = getAgentDemoValues(agent, inputDataSchema);
    if (!demoValues) {
      return <JobInputsFormDemoError />;
    }
  }

  return (
    <JobInputsFormInner
      agent={agent}
      averageExecutionDuration={averageExecutionDuration}
      demoValues={demoValues}
      inputDataSchema={inputDataSchema}
      className={className}
    />
  );
}

function JobInputsFormInner({
  agent,
  averageExecutionDuration,
  demoValues,
  inputDataSchema,
  className,
}: JobInputsFormInnerProps) {
  return (
    <JobInputsFormClient
      agent={agent}
      averageExecutionDuration={averageExecutionDuration}
      inputDataSchema={inputDataSchema}
      demoValues={demoValues}
      legal={getAgentLegal(agent)}
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
