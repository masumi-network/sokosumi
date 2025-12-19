"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  JobEventWithRelations,
  JobWithSokosumiStatus,
} from "@sokosumi/database";
import type {
  InputFieldSchemaType,
  InputSchemaSchemaType,
} from "@sokosumi/masumi/schemas";
import {
  ArrowLeft,
  ArrowRight,
  Command,
  CornerDownLeft,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import React, { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { GroupedInputTabs } from "@/components/common/grouped-input-tabs";
import JobInput from "@/components/create-job-modal/job-input/job-input";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { useGroupedInputWizard } from "@/hooks/use-grouped-input-wizard";
import usePreventEnterSubmit from "@/hooks/use-prevent-enter-submit";
import { CommonErrorCode } from "@/lib/actions";
import { provideJobInput } from "@/lib/actions/job/action";
import { flattenInputs, parseInputSchema } from "@/lib/helpers/input-schema";
import {
  defaultValues,
  filterOutNullValues,
  jobInputsFormSchema,
  JobInputsFormSchemaType,
} from "@/lib/job-input/form";
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

  const parseResult = useMemo(() => {
    return parseInputSchema(event.inputSchema);
  }, [event.inputSchema]);

  // Check if we have any inputs (works for both grouped and flat)
  const flatInputs = useMemo(() => {
    if (!parseResult) return [];
    return flattenInputs(parseResult);
  }, [parseResult]);

  // Create a stable key to force form remount when schemas change
  const formKey = useMemo(() => {
    return flatInputs.map((s) => s.id).join(",");
  }, [flatInputs]);

  if (!parseResult || flatInputs.length === 0) {
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
      inputSchema={parseResult}
    />
  );
}

interface ProvideInputFormProps {
  jobId: string;
  statusId?: string | null;
  inputSchema: InputSchemaSchemaType;
}

function ProvideInputForm({
  jobId,
  statusId,
  inputSchema,
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

  // Flatten the schema to get all input fields (needed for form setup)
  const inputSchemas = useMemo(() => flattenInputs(inputSchema), [inputSchema]);

  const form = useForm<JobInputsFormSchemaType>({
    resolver: zodResolver(jobInputsFormSchema(inputSchemas, tForm)),
    defaultValues: defaultValues(inputSchemas),
    mode: "onChange",
  });

  // Use the wizard hook for grouped input navigation
  const wizard = useGroupedInputWizard({ inputSchema, form });

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

  // Render inputs for a set of schemas
  const renderInputs = (inputs: InputFieldSchemaType[]) => {
    return inputs.map((jobInputSchema) => (
      <JobInput
        key={jobInputSchema.id}
        form={form}
        jobInputSchema={jobInputSchema}
        disabled={isSubmitting || formIsSubmitting}
      />
    ));
  };

  // Render the form footer with action buttons
  const renderFormFooter = (showSubmit: boolean) => (
    <div className="flex items-end justify-between gap-2">
      {wizard.isGrouped && !wizard.isFirstGroup ? (
        <Button
          type="button"
          variant="secondary"
          onClick={wizard.handleBack}
          disabled={wizard.isValidating}
        >
          <ArrowLeft className="size-4" />
          {tForm("back")}
        </Button>
      ) : (
        <div /> /* Spacer to maintain layout */
      )}
      <div className="flex items-center gap-2">
        {showSubmit ? (
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
        ) : (
          <Button
            type="button"
            onClick={wizard.handleNext}
            disabled={wizard.isValidating || !wizard.isCurrentGroupValid}
          >
            {wizard.isValidating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {tForm("next")}
            <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Form {...form}>
      <form ref={formRef} onSubmit={enterPreventedHandleSubmit}>
        <fieldset
          disabled={isSubmitting || formIsSubmitting}
          className="flex min-w-0 flex-1 flex-col gap-6"
        >
          {wizard.isGrouped && wizard.groups ? (
            // Render wizard tabs for grouped inputs
            <GroupedInputTabs
              groups={wizard.groups}
              activeGroupIndex={wizard.activeGroupIndex}
              maxUnlockedGroupIndex={wizard.maxUnlockedGroupIndex}
              onTabChange={wizard.handleTabChange}
              isValidating={wizard.isValidating}
              renderGroup={(group, index, isLast) => (
                <>
                  {renderInputs(group.input_data)}
                  {renderFormFooter(isLast)}
                </>
              )}
            />
          ) : (
            // Render flat inputs (existing behavior)
            <>
              {renderInputs(wizard.flatInputs)}
              {renderFormFooter(true)}
            </>
          )}
        </fieldset>
      </form>
    </Form>
  );
}
