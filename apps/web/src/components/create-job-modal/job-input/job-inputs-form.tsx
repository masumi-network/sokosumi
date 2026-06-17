"use client";

import type { InputSchemaSchemaType } from "@sokosumi/masumi/schemas";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { useInputs } from "@/hooks/use-inputs";
import { getAgentLegal } from "@/lib/helpers/agent";
import type { CoreAgentDto } from "@/lib/types/core-dto";
import { getAgentInputSchemaQueryOptions } from "@/queries/agents";

import { JobInputsFlatForm } from "./job-inputs-flat-form";
import { JobInputsGroupedForm } from "./job-inputs-grouped-form";

interface JobInputsFormProps {
  agent: CoreAgentDto;
  averageExecutionDuration: number | null;
  className?: string | undefined;
}

interface JobInputsFormInnerProps extends JobInputsFormProps {
  inputSchema: InputSchemaSchemaType;
}

export default function JobInputsForm({
  agent,
  averageExecutionDuration,
  className,
}: JobInputsFormProps) {
  const {
    data: inputSchema,
    isLoading,
    error,
  } = useQuery({
    ...getAgentInputSchemaQueryOptions(agent.id),
    enabled: !!agent.id,
  });

  if (isLoading) {
    return <JobInputsFormSkeleton />;
  }

  if (error || !inputSchema) {
    return <JobInputsFormError />;
  }

  return (
    <JobInputsFormInner
      agent={agent}
      averageExecutionDuration={averageExecutionDuration}
      inputSchema={inputSchema}
      className={className}
    />
  );
}

function JobInputsFormInner({
  agent,
  averageExecutionDuration,
  inputSchema,
  className,
}: JobInputsFormInnerProps) {
  const inputs = useInputs({ inputSchema });
  const legal = getAgentLegal(agent);

  // Render grouped form if schema has groups
  if (inputs.isGrouped && inputs.groups) {
    return (
      <JobInputsGroupedForm
        agent={agent}
        averageExecutionDuration={averageExecutionDuration}
        groups={inputs.groups}
        inputSchema={inputSchema}
        legal={legal}
        className={className}
        activeGroupIndex={inputs.activeGroupIndex}
        maxUnlockedGroupIndex={inputs.maxUnlockedGroupIndex}
        goToNext={inputs.goToNext}
        goBack={inputs.goBack}
        goToGroup={inputs.goToGroup}
        reset={inputs.reset}
        resetMaxUnlockedTo={inputs.resetMaxUnlockedTo}
      />
    );
  }

  // Render flat form for non-grouped schemas
  return (
    <JobInputsFlatForm
      agent={agent}
      averageExecutionDuration={averageExecutionDuration}
      flatInputs={inputs.flatInputs}
      inputSchema={inputSchema}
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
