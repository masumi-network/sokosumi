"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SubmitHandler, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { startJobWithInputData } from "@/lib/actions/job.actions";
import {
  defaultValues,
  JobInputsDataSchemaType,
  jobInputsFormSchema,
  JobInputsFormSchemaType,
} from "@/lib/job-input";
import { cn } from "@/lib/utils";

import JobInput from "./job-input";
import { useRouterPush, useRouterRefresh } from "./util";

interface JobInputsFormProps {
  agentId: string;
  agentPricing: number;
  jobInputsDataSchema: JobInputsDataSchemaType;
  className?: string | undefined;
}

export default function JobInputsForm({
  agentId,
  agentPricing,
  jobInputsDataSchema,
  className,
}: JobInputsFormProps) {
  const router = useRouter();
  const { input_data } = jobInputsDataSchema;
  const t = useTranslations("Library.JobInput.Form");
  const form = useForm<JobInputsFormSchemaType>({
    resolver: zodResolver(jobInputsFormSchema(input_data, t)),
    defaultValues: defaultValues(input_data),
  });
  // const credits = agentPricing;
  const refresh = useRouterRefresh();
  const push = useRouterPush();
  const pathname = usePathname();

  // Then replace your existing handleSubmit function with this:
  const handleSubmit: SubmitHandler<JobInputsFormSchemaType> = async (
    values,
  ) => {
    try {
      // Transform input data to match expected type
      // Filter out null values and ensure arrays are of correct type
      const transformedInputData: Record<
        string,
        string | number | boolean | number[]
      > = {};

      Object.entries(values).forEach(([key, value]) => {
        // Skip null values
        if (value === null) return;

        // Convert string[] to number[] if possible
        if (
          Array.isArray(value) &&
          value.every((item) => typeof item === "string")
        ) {
          // Try to convert string array to number array
          const numArray = value.map((v) => Number(v)).filter((n) => !isNaN(n));
          if (numArray.length === value.length) {
            // All strings were successfully converted to numbers
            transformedInputData[key] = numArray;
            return;
          }
        }

        // For other valid types, add them directly
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          transformedInputData[key] = value;
        }
      });
      const result = await startJobWithInputData({
        agentId: agentId,
        maxAcceptedCreditCost: agentPricing,
        inputData: transformedInputData,
      });

      if (result.jobId) {
        form.reset();
        // prefetch the job page and load async to stay when loading
        router.prefetch(`${pathname}/${result.jobId}`);
        await refresh();
        await push(`${pathname}/${result.jobId}`);
      }
    } catch (error) {
      console.error(error);
      // You might want to add toast notifications or other error handling here
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
