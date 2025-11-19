"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { JobWithStatus } from "@sokosumi/database";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import React from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import { toast } from "sonner";

import JobInput from "@/components/create-job-modal/job-input/job-input";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import {
  defaultValues,
  filterOutNullValues,
  jobInputSchema,
  JobInputSchemaType,
  jobInputsFormSchema,
  JobInputsFormSchemaType,
} from "@/lib/job-input";

interface JobDetailsProvideInputProps {
  job: JobWithStatus;
}

export default function JobDetailsProvideInput({
  job,
}: JobDetailsProvideInputProps) {
  const t = useTranslations("Components.Jobs.JobDetails.AwaitingInput");
  const tForm = useTranslations("Library.JobInput.Form");
  const _router = useRouter();

  // Parse input schema from job - validate each entry individually
  const inputSchemas = React.useMemo<JobInputSchemaType[]>(() => {
    try {
      if (job.inputSchema) {
        const parsed = JSON.parse(job.inputSchema);
        if (Array.isArray(parsed)) {
          // Validate each entry individually to allow partial success
          const validatedSchemas: JobInputSchemaType[] = [];
          for (const entry of parsed) {
            const schemaResult = jobInputSchema().safeParse(entry);
            if (schemaResult.success) {
              validatedSchemas.push(schemaResult.data);
            } else {
              console.warn("Failed to validate input schema entry:", entry);
            }
          }
          return validatedSchemas;
        }
      }
    } catch (_error) {
      console.error("Failed to parse input schema", _error);
    }
    return [];
  }, [job.inputSchema]);

  const form = useForm<JobInputsFormSchemaType>({
    resolver: zodResolver(jobInputsFormSchema(inputSchemas, tForm)),
    defaultValues: defaultValues(inputSchemas),
    mode: "onChange",
  });

  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit: SubmitHandler<JobInputsFormSchemaType> = async (
    values,
  ) => {
    setIsSubmitting(true);

    try {
      const _transformedInputData = filterOutNullValues(values);

      // TODO: Handle agent input schema
      // const result = await provideJobInput({
      //   input: {
      //     jobId: job.id,
      //     inputData: transformedInputData,
      //   },
      // });

      // setIsSubmitting(false);

      // if (result.ok) {
      //   toast.success(t("submitSuccess"));
      //   router.refresh();
      // } else {
      //   console.log("result", result);
      //   switch (result.error.code) {
      //     case CommonErrorCode.UNAUTHENTICATED:
      //       toast.error(tForm("Error.unauthenticated"));
      //       break;
      //     case CommonErrorCode.BAD_INPUT:
      //       toast.error(tForm("Error.badInput"));
      //       break;
      //     default:
      //       toast.error(t("submitError"));
      //       break;
      //   }
      // }
    } catch (_error) {
      setIsSubmitting(false);
      toast.error(t("submitError"));
    }
  };

  const { isSubmitting: formIsSubmitting, isValid } = form.formState;

  if (inputSchemas.length === 0) {
    return (
      <div className="text-muted-foreground py-4 text-center">
        {t("noInputsRequired")}
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)}>
        <fieldset
          disabled={isSubmitting || formIsSubmitting}
          className="flex flex-1 flex-col gap-6"
        >
          {inputSchemas.map((jobInputSchema) => (
            <JobInput
              key={jobInputSchema.id}
              form={form}
              jobInputSchema={jobInputSchema}
              disabled={isSubmitting || formIsSubmitting}
            />
          ))}
          <div className="flex items-end justify-end gap-2">
            <Button
              type="submit"
              disabled={isSubmitting || formIsSubmitting || !isValid}
            >
              {(isSubmitting || formIsSubmitting) && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              {t("submit")}
            </Button>
          </div>
        </fieldset>
      </form>
    </Form>
  );
}
