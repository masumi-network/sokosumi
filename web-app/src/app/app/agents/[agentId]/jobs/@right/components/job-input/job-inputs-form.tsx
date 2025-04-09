import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { getAgentInputSchema } from "@/lib/db/services/agent.service";

import JobInputsFormClient from "./job-inputs-form.client";
import JobInputsFormErrorWrapper from "./job-inputs-form.error";

interface JobInputsFormProps {
  agentId: string;
  agentPricing: number;
  className?: string | undefined;
}

export default function JobInputsForm({
  agentId,
  agentPricing,
  className,
}: JobInputsFormProps) {
  return (
    <JobInputsFormErrorWrapper>
      <Suspense fallback={<JobInputsFormSkeleton />}>
        <JobInputsFormInner
          agentId={agentId}
          agentPricing={agentPricing}
          className={className}
        />
      </Suspense>
    </JobInputsFormErrorWrapper>
  );
}

async function JobInputsFormInner({
  agentId,
  agentPricing,
  className,
}: JobInputsFormProps) {
  const inputSchema = await getAgentInputSchema(agentId);

  return (
    <JobInputsFormClient
      agentId={agentId}
      agentPricing={agentPricing}
      jobInputsDataSchema={inputSchema}
      className={className}
    />
  );
}

function JobInputsFormSkeleton() {
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
