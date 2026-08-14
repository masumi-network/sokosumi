"use client";

import {
  type InputSchemaSchemaType,
  normalizeAndValidateInputSchema,
} from "@sokosumi/masumi/schemas";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Command,
  CornerDownLeft,
  Loader2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";

import { JobInputsFlatForm } from "@/components/job-input/job-inputs-flat-form";
import type { FormFooterProps } from "@/components/job-input/job-inputs-form-builder";
import { JobInputsGroupedForm } from "@/components/job-input/job-inputs-grouped-form";
import { Button } from "@/components/ui/button";
import { useInputs } from "@/hooks/use-inputs";
import { useOSDetection } from "@/hooks/use-os-detection";
import { useProvideJobInput } from "@/hooks/use-provide-job-input";
import type { Job } from "@/lib/clients/generated/core";
import { flattenInputs } from "@/lib/schemas/job";
import { getReadonlyNoneInputValues } from "@/lib/utils/job-input-transformers";
import { getJobQueryKey } from "@/queries";

import type { JobEvent } from "./job-details-events.utils";

interface JobDetailsProvideInputProps {
  job: Job;
  event: JobEvent;
}

export default function JobDetailsProvideInput({
  job,
  event,
}: JobDetailsProvideInputProps) {
  const t = useTranslations("Components.Jobs.JobDetails.AwaitingInput");

  const parseResult = useMemo(() => {
    if (!event.inputSchema) return null;

    try {
      const parsed = JSON.parse(event.inputSchema);
      return normalizeAndValidateInputSchema(parsed);
    } catch (error) {
      console.error("[provide-input] Failed to parse JSON:", error);
      return null;
    }
  }, [event.inputSchema]);

  const flatInputs = useMemo(() => {
    if (!parseResult) return [];
    return flattenInputs(parseResult);
  }, [parseResult]);

  const formKey = flatInputs.map((s) => s.id).join(",");

  if (!parseResult || flatInputs.length === 0) {
    return (
      <div className="text-muted-foreground py-4 text-center">
        {t("noInputsRequired")}
      </div>
    );
  }

  return (
    <ProvideInputForm
      key={formKey}
      jobId={job.id}
      eventId={event.id}
      inputSchema={parseResult}
    />
  );
}

interface ProvideInputFormProps {
  jobId: string;
  eventId?: string | null;
  inputSchema: InputSchemaSchemaType;
}

function ProvideInputForm({
  jobId,
  eventId,
  inputSchema,
}: ProvideInputFormProps) {
  const t = useTranslations("Components.Jobs.JobDetails.AwaitingInput");
  const tForm = useTranslations("Library.JobInput.Form");
  const inputs = useInputs({ inputSchema });
  const { os, isMobile } = useOSDetection();

  const inputFields = useMemo(() => {
    return flattenInputs(inputSchema);
  }, [inputSchema]);

  const readonlyInputValues = useMemo(() => {
    return getReadonlyNoneInputValues(inputFields);
  }, [inputFields]);

  const inputFieldIdsInOrder = useMemo(() => {
    return inputFields.map((inputField) => inputField.id);
  }, [inputFields]);

  const queryClient = useQueryClient();
  const { handleSubmit, isSubmitting } = useProvideJobInput({
    jobId,
    eventId,
    readonlyInputValues,
    inputFieldIdsInOrder,
    // Core provides the input now and no longer emits an immediate Ably status
    // push, so invalidate the cached job here to clear the awaiting-input form
    // (job-sync publishes the eventual status transition as usual).
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: getJobQueryKey(jobId) }),
  });

  // Handle group clear - the generic form manages accumulated values internally
  const handleGroupClear = useCallback(
    (groupIndex: number, formReset: () => void) => {
      formReset();

      if (groupIndex === 0) {
        inputs.reset();
      } else {
        inputs.resetMaxUnlockedTo(groupIndex);
      }
    },
    [inputs],
  );

  // Custom footer for flat form
  const renderFlatFooter = useCallback(
    (props: FormFooterProps) => {
      const { isSubmitting: formIsSubmitting, isValid, reset } = props;

      return (
        <div className="flex items-end justify-between gap-2">
          <Button type="reset" variant="secondary" onClick={reset}>
            {tForm("clear")}
          </Button>
          <div className="flex items-center gap-2">
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
        </div>
      );
    },
    [isSubmitting, t, tForm, isMobile, os],
  );

  // Custom footer for grouped form
  const renderGroupFooter = useCallback(
    (props: FormFooterProps, isLast: boolean, groupIndex: number) => {
      const {
        isSubmitting: formIsSubmitting,
        isValid,
        reset: formReset,
      } = props;
      const isFirst = groupIndex === 0;

      return (
        <div className="flex items-end justify-between gap-2">
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button type="button" variant="secondary" onClick={inputs.goBack}>
                <ArrowLeft className="size-4" />
                {tForm("back")}
              </Button>
            )}
            <Button
              type="reset"
              variant="secondary"
              onClick={() => handleGroupClear(groupIndex, formReset)}
            >
              {tForm("clear")}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {isLast ? (
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
              <Button type="submit" disabled={formIsSubmitting || !isValid}>
                {formIsSubmitting && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {tForm("next")}
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      );
    },
    [isSubmitting, t, tForm, isMobile, os, inputs.goBack, handleGroupClear],
  );

  // Render grouped form if schema has groups
  if (inputs.isGrouped && inputs.groups) {
    return (
      <JobInputsGroupedForm
        groups={inputs.groups}
        className="min-w-0"
        activeGroupIndex={inputs.activeGroupIndex}
        maxUnlockedGroupIndex={inputs.maxUnlockedGroupIndex}
        goToNext={inputs.goToNext}
        goBack={inputs.goBack}
        goToGroup={inputs.goToGroup}
        reset={inputs.reset}
        resetMaxUnlockedTo={inputs.resetMaxUnlockedTo}
        customOnSubmit={handleSubmit}
        customRenderGroupFooter={renderGroupFooter}
        customIsSubmitting={isSubmitting}
        customIsActive={true}
      />
    );
  }

  // Render flat form for non-grouped schemas
  return (
    <JobInputsFlatForm
      flatInputs={inputs.flatInputs}
      className="min-w-0"
      customOnSubmit={handleSubmit}
      customRenderFooter={renderFlatFooter}
      customIsSubmitting={isSubmitting}
      customIsActive={true}
    />
  );
}
