"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SubmitHandler, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
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

  const handleSubmit: SubmitHandler<JobInputsFormSchemaType> = async (
    values,
  ) => {
    try {
      console.log(values, agentPricing);
      const response = await fetch("/api/job/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentId: agentId,
          maxAcceptedCreditCost: agentPricing,
          inputData: Object.fromEntries(Object.entries(values)),
        }),
      });

      if (response.ok) {
        form.reset();
        const data = await response.json();
        // prefetch the job page and load async to stay when loading
        router.prefetch(`/app/agents/${agentId}/jobs/${data.jobId}`);
        await refresh();
        await push(`/app/agents/${agentId}/jobs/${data.jobId}`);
      }
    } catch (error) {
      console.error(error);
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
