"use client";

import { AgentWithCreditsPrice } from "@sokosumi/database";
import { InputSchemaSchemaType } from "@sokosumi/masumi/schemas";
import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import useAgentInputSchema from "@/hooks/use-agent-input-schema";
import { useInputs } from "@/hooks/use-inputs";
import { getAgentDemoValues, getAgentLegal } from "@/lib/helpers/agent";
import { AgentDemoValues } from "@/lib/types/agent";

import { JobInputsFlatForm } from "./job-inputs-flat-form";
import { JobInputsGroupedForm } from "./job-inputs-grouped-form";

interface JobInputsFormProps {
  agent: AgentWithCreditsPrice;
  averageExecutionDuration: number | null;
  isDemo: boolean;
  className?: string | undefined;
}

interface JobInputsFormInnerProps extends Omit<JobInputsFormProps, "isDemo"> {
  inputSchema: InputSchemaSchemaType;
  demoValues: AgentDemoValues | null;
}

export default function JobInputsForm({
  agent,
  averageExecutionDuration,
  isDemo,
  className,
}: JobInputsFormProps) {
  const { data: inputSchema, loading, error } = useAgentInputSchema(agent.id);

  if (loading) {
    return <JobInputsFormSkeleton />;
  }

  if (error || !inputSchema) {
    return <JobInputsFormError />;
  }

  // check demo data is valid
  let demoValues: AgentDemoValues | null = null;
  if (isDemo) {
    demoValues = getAgentDemoValues(agent, inputSchema);
    if (!demoValues) {
      return <JobInputsFormDemoError />;
    }
  }

  return (
    <JobInputsFormInner
      agent={agent}
      averageExecutionDuration={averageExecutionDuration}
      demoValues={demoValues}
      inputSchema={inputSchema}
      className={className}
    />
  );
}

function JobInputsFormInner({
  agent,
  averageExecutionDuration,
  demoValues,
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
        flatInputs={inputs.flatInputs}
        demoValues={demoValues}
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
