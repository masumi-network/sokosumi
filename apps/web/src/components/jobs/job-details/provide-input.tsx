"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  JobEventWithRelations,
  JobWithSokosumiStatus,
} from "@sokosumi/database";
import {
  inputFieldSchema,
  InputFieldSchemaType,
} from "@sokosumi/masumi/schemas";
import { Command, CornerDownLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import React, { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import JobInput from "@/components/create-job-modal/job-input/job-input";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import usePreventEnterSubmit from "@/hooks/use-prevent-enter-submit";
import { CommonErrorCode } from "@/lib/actions";
import { provideJobInput } from "@/lib/actions/job/action";
import {
  defaultValues,
  filterOutNullValues,
  jobInputsFormSchema,
  JobInputsFormSchemaType,
} from "@/lib/job-input";
import { getOSFromUserAgent, type OS } from "@/lib/utils";

interface JobDetailsProvideInputProps {
  job: JobWithSokosumiStatus;
  event: JobEventWithRelations;
}

export default function JobDetailsProvideInput({
  job,
  event,
}: JobDetailsProvideInputProps) {
  const t = useTranslations("Components.Jobs.JobDetails.AwaitingInput");

  // Parse input schema from job - validate each entry individually
  const inputSchemas = useMemo<InputFieldSchemaType[]>(() => {
    try {
      if (event.inputSchema) {
        const parsed = JSON.parse(event.inputSchema);
        if (Array.isArray(parsed)) {
          // Validate each entry individually to allow partial success
          const validatedSchemas: InputFieldSchemaType[] = [];
          for (const entry of parsed) {
            const schemaResult = inputFieldSchema.safeParse(entry);
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
  }, [event.inputSchema]);

  // Create a stable key to force form remount when schemas change
  // This ensures useForm is re-initialized with correct resolver and defaultValues
  const formKey = useMemo(
    () => inputSchemas.map((s) => s.id).join(","),
    [inputSchemas],
  );

  if (inputSchemas.length === 0) {
    return (
      <div className="text-muted-foreground py-4 text-center">
        {t("noInputsRequired")}
      </div>
    );
  }

  // Render form in a keyed component so useForm re-initializes when schemas change
  return (
    <ProvideInputForm
      key={formKey}
      jobId={job.id}
      statusId={event.externalId}
      inputSchemas={inputSchemas}
    />
  );
}

interface ProvideInputFormProps {
  jobId: string;
  statusId?: string | null;
  inputSchemas: InputFieldSchemaType[];
}
function ProvideInputForm({
  jobId,
  statusId,
  inputSchemas,
}: ProvideInputFormProps) {
  const t = useTranslations("Components.Jobs.JobDetails.AwaitingInput");
  const tForm = useTranslations("Library.JobInput.Form");
  const router = useRouter();

  // Defer OS detection to client-side to avoid hydration mismatch
  const [{ os, isMobile }, setOsInfo] = useState<{
    os: OS;
    isMobile: boolean;
  }>({ os: "Unknown", isMobile: false });

  useEffect(() => {
    setOsInfo(getOSFromUserAgent());
  }, []);

  const form = useForm<JobInputsFormSchemaType>({
    resolver: zodResolver(jobInputsFormSchema(inputSchemas, tForm)),
    defaultValues: defaultValues(inputSchemas),
    mode: "onChange",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async () => {
    setIsSubmitting(true);

    // Use form.getValues() directly to get the current form values
    const values = form.getValues();
    try {
      const transformedInputData = filterOutNullValues(values);

      if (!statusId) {
        throw new Error("Status ID is required");
      }

      const result = await provideJobInput({
        input: {
          jobId,
          statusId,
          inputData: transformedInputData,
        },
      });
      setIsSubmitting(false);

      if (result.ok) {
        toast.success(t("submitSuccess"));
        router.refresh();
      } else {
        switch (result.error.code) {
          case CommonErrorCode.UNAUTHENTICATED:
            toast.error(tForm("Error.unauthenticated"));
            break;
          case CommonErrorCode.BAD_INPUT:
            toast.error(tForm("Error.badInput"));
            break;
          default:
            toast.error(t("submitError"));
            break;
        }
      }
    } catch (_error) {
      setIsSubmitting(false);
      toast.error(t("submitError"));
    }
  };

  const { isSubmitting: formIsSubmitting, isValid } = form.formState;

  const { formRef, handleSubmit: enterPreventedHandleSubmit } =
    usePreventEnterSubmit(form, onSubmit, true);

  return (
    <Form {...form}>
      <form ref={formRef} onSubmit={enterPreventedHandleSubmit}>
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
              className="items-center justify-between gap-1"
            >
              <div className="flex items-center gap-1">
                {(isSubmitting || formIsSubmitting) && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {t("submit")}
              </div>
              {!isMobile && (
                <div className="flex items-center gap-1">
                  {os === "MacOS" ? <Command /> : tForm("ctrl")}
                  <CornerDownLeft />
                </div>
              )}
            </Button>
          </div>
        </fieldset>
      </form>
    </Form>
  );
}
