"use client";

import {
  JobEventWithRelations,
  JobWithSokosumiStatus,
} from "@sokosumi/database";
import { type InputSchemaSchemaType } from "@sokosumi/masumi/schemas";
import {
  ArrowLeft,
  ArrowRight,
  Command,
  CornerDownLeft,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { GroupedInputTabs } from "@/components/common/grouped-input-tabs";
import {
  FormFooterProps,
  JobInputsFormBuilder,
} from "@/components/create-job-modal/job-input/job-inputs-form-builder";
import { Button } from "@/components/ui/button";
import { useInputs } from "@/hooks/use-inputs";
import { CommonErrorCode } from "@/lib/actions";
import { provideJobInput } from "@/lib/actions/job/action";
import {
  defaultValues,
  filterOutNullValues,
  JobInputsFormSchemaType,
} from "@/lib/job-input/form";
import {
  flattenInputs,
  normalizeAndValidateInputSchema,
} from "@/lib/schemas/job";
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

  const inputs = useInputs({ inputSchema });

  const [accumulatedValues, setAccumulatedValues] =
    useState<JobInputsFormSchemaType>({});

  const resetInputs = useRef(inputs.reset);
  resetInputs.current = inputs.reset;

  useEffect(() => {
    setAccumulatedValues({});
    resetInputs.current();
  }, [inputSchema]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFinalSubmit = useCallback(
    async (allValues: JobInputsFormSchemaType) => {
      setIsSubmitting(true);

      try {
        const transformedInputData = filterOutNullValues(allValues);

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
    },
    [jobId, statusId, t, tForm, router],
  );

  const handleGroupNext = useCallback(
    (groupValues: JobInputsFormSchemaType) => {
      setAccumulatedValues((prev) => ({ ...prev, ...groupValues }));
      inputs.goToNext();
    },
    [inputs],
  );

  const handleGroupSubmit = useCallback(
    (lastGroupValues: JobInputsFormSchemaType) => {
      const allValues = { ...accumulatedValues, ...lastGroupValues };
      handleFinalSubmit(allValues);
    },
    [accumulatedValues, handleFinalSubmit],
  );

  const handleFlatSubmit = useCallback(
    (values: JobInputsFormSchemaType) => {
      handleFinalSubmit(values);
    },
    [handleFinalSubmit],
  );

  const handleGroupClear = useCallback(
    (groupIndex: number, formReset: () => void) => {
      if (!inputs.groups) return;
      const group = inputs.groups[groupIndex];
      if (!group) return;

      // Reset the current form
      formReset();

      // Get field IDs for the current group
      const groupFieldIds = group.input_data.map((field) => field.id);

      // Remove the current group's values from accumulatedValues
      setAccumulatedValues((prev) => {
        const filtered = Object.fromEntries(
          Object.entries(prev).filter(([key]) => !groupFieldIds.includes(key)),
        );
        return filtered;
      });

      // Reset maxUnlockedGroupIndex to current group index (lock later groups)
      // If clearing first group, reset everything
      if (groupIndex === 0) {
        setAccumulatedValues({});
        inputs.reset();
      } else {
        inputs.resetMaxUnlockedTo(groupIndex);
      }
    },
    [inputs],
  );

  const getGroupDefaultValues = useCallback(
    (groupIndex: number) => {
      if (!inputs.groups) return {};
      const group = inputs.groups[groupIndex];
      if (!group) return {};

      const groupFieldIds = group.input_data.map((field) => field.id);

      const fromAccumulated = Object.fromEntries(
        Object.entries(accumulatedValues).filter(([key]) =>
          groupFieldIds.includes(key),
        ),
      );

      const defaults = defaultValues(group.input_data);

      return { ...defaults, ...fromAccumulated };
    },
    [inputs.groups, accumulatedValues],
  );

  const renderGroupFooter = useCallback(
    (props: FormFooterProps, isLast: boolean, groupIndex: number) => {
      const { isSubmitting: formIsSubmitting, isValid, reset } = props;
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
              onClick={() => handleGroupClear(groupIndex, reset)}
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
    [isSubmitting, t, tForm, isMobile, os, inputs, handleGroupClear],
  );

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

  const flatDefaultValues = useMemo(
    () => defaultValues(inputs.flatInputs),
    [inputs.flatInputs],
  );

  const handleTabChange = useCallback(
    (groupId: string) => {
      if (!inputs.groups) return;
      const index = inputs.groups.findIndex((g) => g.id === groupId);
      if (index >= 0) {
        inputs.goToGroup(index);
      }
    },
    [inputs],
  );

  return inputs.isGrouped && inputs.groups ? (
    <GroupedInputTabs
      groups={inputs.groups}
      activeGroupIndex={inputs.activeGroupIndex}
      maxUnlockedGroupIndex={inputs.maxUnlockedGroupIndex}
      onTabChange={handleTabChange}
      className="min-w-0"
      renderGroup={(group, index, isLast) => (
        <JobInputsFormBuilder
          key={group.id}
          inputFields={group.input_data}
          defaultValues={getGroupDefaultValues(index)}
          onSubmit={isLast ? handleGroupSubmit : handleGroupNext}
          renderFooter={(props) => renderGroupFooter(props, isLast, index)}
          disabled={isSubmitting}
          isActive={inputs.activeGroupIndex === index}
          t={tForm}
        />
      )}
    />
  ) : (
    <JobInputsFormBuilder
      inputFields={inputs.flatInputs}
      defaultValues={flatDefaultValues}
      onSubmit={handleFlatSubmit}
      renderFooter={renderFlatFooter}
      className="min-w-0"
      disabled={isSubmitting}
      isActive={true}
      t={tForm}
    />
  );
}
