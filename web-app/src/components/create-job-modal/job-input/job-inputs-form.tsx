"use client";

import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import useAgentInputSchema from "@/hooks/use-agent-input-schema";
import { AgentLegal, CreditsPrice } from "@/lib/db";
import { JobInputsDataSchemaType } from "@/lib/job-input";

import JobInputsFormClient from "./job-inputs-form.client";

interface JobInputsFormProps {
  agentId: string;
  agentCreditsPrice: CreditsPrice;
  averageExecutionDuration: number;
  legal?: AgentLegal | null | undefined;
  className?: string | undefined;
}

interface JobInputsFormInnerProps extends JobInputsFormProps {
  inputSchema: JobInputsDataSchemaType;
}

export default function JobInputsForm({
  agentId,
  agentCreditsPrice,
  averageExecutionDuration,
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

  return (
    <JobInputsFormInner
      agentId={agentId}
      agentCreditsPrice={agentCreditsPrice}
      averageExecutionDuration={averageExecutionDuration}
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
