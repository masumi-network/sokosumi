"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { SubmitHandler, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { useAsyncRouterPush } from "@/hooks/use-async-router";
import { startJobWithInputData } from "@/lib/actions/job.actions";
import { convertCreditsToBaseUnits } from "@/lib/db/utils/credit.utils";
import {
  defaultValues,
  JobInputsDataSchemaType,
  jobInputsFormSchema,
  JobInputsFormSchemaType,
} from "@/lib/job-input";
import { cn } from "@/lib/utils";

import JobInput from "./job-input";

interface JobInputsFormClientProps {
  agentId: string;
  agentPricing: number;
  jobInputsDataSchema: JobInputsDataSchemaType;
  className?: string | undefined;
}

function filterOutNullValues(values: JobInputsFormSchemaType) {
  return Object.fromEntries(
    Object.entries(values).filter(([_, value]) => value !== null) as [
      string,
      string | number | boolean | number[],
    ][],
  );
}

export default function JobInputsFormClient({
  agentId,
  agentPricing,
  jobInputsDataSchema,
  className,
}: JobInputsFormClientProps) {
  const { input_data } = jobInputsDataSchema;
  const t = useTranslations("Library.JobInput.Form");
  const form = useForm<JobInputsFormSchemaType>({
    resolver: zodResolver(jobInputsFormSchema(input_data, t)),
    defaultValues: defaultValues(input_data),
  });
  const asyncRouter = useAsyncRouterPush();
  const pathname = usePathname();

  // Then replace your existing handleSubmit function with this:
  const handleSubmit: SubmitHandler<JobInputsFormSchemaType> = async (
    values,
  ) => {
    try {
      // Transform input data to match expected type
      // Filter out null values and ensure arrays are of correct type
      const transformedInputData = filterOutNullValues(values);
      const result = await startJobWithInputData({
        agentId: agentId,
        maxAcceptedCredits: convertCreditsToBaseUnits(agentPricing),
        inputData: transformedInputData,
      });

      if (result.success && result.data?.jobId) {
        form.reset();
        await asyncRouter.push(`${pathname}/${result.data.jobId}`);
      }
    } catch (error) {
      console.error(error);
      toast.error(t("error"));
    }
  };

  const handleClear = () => {
    form.reset();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)}>
        <fieldset
          disabled={form.formState.isSubmitting}
          className={cn("flex flex-1 flex-col gap-6", className)}
        >
          {input_data.map((jobInputSchema) => (
            <JobInput
              key={jobInputSchema.id}
              form={form}
              jobInputSchema={jobInputSchema}
            />
          ))}
          <div className="flex items-center justify-between gap-2">
            <Button type="reset" variant="outline" onClick={handleClear}>
              {t("clear")}
            </Button>
            <div className="flex items-center gap-2">
              <div className="text-muted-foreground text-sm">
                {t("price", { price: agentPricing })}
              </div>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {t("submit")}
              </Button>
            </div>
          </div>
        </fieldset>
      </form>
    </Form>
  );
}
