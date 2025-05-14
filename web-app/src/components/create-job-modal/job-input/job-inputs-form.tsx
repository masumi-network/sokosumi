"use client";

import { useTranslations } from "next-intl";
import { Suspense, use } from "react";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentLegal, CreditsPrice } from "@/lib/db";
import { JobInputsDataSchemaType } from "@/lib/job-input";

import JobInputsFormClient from "./job-inputs-form.client";

interface JobInputsFormProps {
  agentId: string;
  agentCreditsPrice: CreditsPrice;
  inputSchemaPromise: Promise<JobInputsDataSchemaType>;
  legal?: AgentLegal | null | undefined;
  className?: string | undefined;
}

export default function JobInputsForm({
  agentId,
  agentCreditsPrice,
  inputSchemaPromise,
  legal,
  className,
}: JobInputsFormProps) {
  return (
    <DefaultErrorBoundary fallback={<JobInputsFormError />}>
      <Suspense fallback={<JobInputsFormSkeleton />}>
        <JobInputsFormInner
          agentId={agentId}
          agentCreditsPrice={agentCreditsPrice}
          inputSchemaPromise={inputSchemaPromise}
          legal={legal}
          className={className}
        />
      </Suspense>
    </DefaultErrorBoundary>
  );
}

function JobInputsFormInner({
  agentId,
  agentCreditsPrice,
  inputSchemaPromise,
  legal,
  className,
}: JobInputsFormProps) {
  const inputSchema = use(inputSchemaPromise);

  return (
    <JobInputsFormClient
      agentId={agentId}
      agentCreditsPrice={agentCreditsPrice}
      jobInputsDataSchema={inputSchema}
      legal={legal}
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
