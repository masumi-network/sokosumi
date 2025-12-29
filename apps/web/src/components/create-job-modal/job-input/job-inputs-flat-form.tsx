"use client";

import { AgentWithCreditsPrice } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";
import type { InputFieldSchemaType } from "@sokosumi/masumi/schemas";
import {
  CalendarClock,
  Clock,
  Command,
  CornerDownLeft,
  Loader2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback, useMemo } from "react";

import { useCreateJobModalContext } from "@/components/create-job-modal";
import { JobScheduleModal } from "@/components/create-job-modal/job-schedule-modal";
import { Button } from "@/components/ui/button";
import { useJobSchedule } from "@/hooks/use-job-schedule";
import { useJobSubmission } from "@/hooks/use-job-submission";
import { defaultValues, JobInputsFormSchemaType } from "@/lib/job-input";
import { AgentDemoValues, AgentLegal } from "@/lib/types/agent";
import { JobScheduleSelectionType } from "@/lib/types/job";
import { cn, formatDuration, getOSFromUserAgent } from "@/lib/utils";

import { AcceptTermsOfService } from "./accept-terms-of-service";
import {
  FormFooterProps,
  JobInputsFormBuilder,
} from "./job-inputs-form-builder";

// Props for standard create job modal mode
interface StandardModeProps {
  agent: AgentWithCreditsPrice;
  averageExecutionDuration: number | null;
  flatInputs: InputFieldSchemaType[];
  demoValues: AgentDemoValues | null;
  legal: AgentLegal | null;
  className?: string;
  // Custom mode props should be undefined
  customOnSubmit?: undefined;
  customRenderFooter?: undefined;
  customIsSubmitting?: undefined;
  customIsActive?: undefined;
}

// Props for custom mode (e.g., provide input)
interface CustomModeProps {
  flatInputs: InputFieldSchemaType[];
  className?: string;
  // Custom mode required props
  customOnSubmit: (values: JobInputsFormSchemaType) => void | Promise<void>;
  customRenderFooter: (props: FormFooterProps) => React.ReactNode;
  customIsSubmitting: boolean;
  customIsActive: boolean;
  // Standard mode props should be undefined
  agent?: undefined;
  averageExecutionDuration?: undefined;
  demoValues?: undefined;
  legal?: undefined;
}

type JobInputsFlatFormProps = StandardModeProps | CustomModeProps;

function isCustomMode(props: JobInputsFlatFormProps): props is CustomModeProps {
  return props.customOnSubmit !== undefined;
}

export function JobInputsFlatForm(props: JobInputsFlatFormProps) {
  if (isCustomMode(props)) {
    return <JobInputsFlatFormCustom {...props} />;
  }

  return <JobInputsFlatFormStandard {...props} />;
}

// Standard mode component (create job modal)
function JobInputsFlatFormStandard({
  agent,
  averageExecutionDuration,
  flatInputs,
  demoValues,
  legal,
  className,
}: StandardModeProps) {
  const { creditsPrice } = agent;
  const t = useTranslations("Library.JobInput.Form");
  const tDuration = useTranslations("Library.Duration.Short");

  const { os, isMobile } = getOSFromUserAgent();

  const { open, loading, setLoading, handleClose } = useCreateJobModalContext();

  const {
    scheduleOpen,
    setScheduleOpen,
    scheduleSelection,
    setScheduleSelection,
    timezoneOptions,
    isScheduled,
    nextRunLabel,
  } = useJobSchedule();

  const { handleSubmit } = useJobSubmission({
    agent,
    flatInputs,
    demoValues,
    scheduleSelection,
    setLoading,
    onSuccess: handleClose,
  });

  const formattedDuration = formatDuration(averageExecutionDuration, tDuration);
  const isDemo = !!demoValues;

  const handleFlatSubmit = useCallback(
    (values: JobInputsFormSchemaType) => {
      handleSubmit(values);
    },
    [handleSubmit],
  );

  const renderFlatFooter = useCallback(
    (props: FormFooterProps) => {
      const { isSubmitting, isValid, reset } = props;

      return (
        <>
          {isScheduled && nextRunLabel && (
            <div className="text-muted-foreground inline-flex items-center gap-1 text-sm">
              <Clock className="size-4" />
              {nextRunLabel}
            </div>
          )}
          <div className="flex items-end justify-between gap-2">
            <Button
              type="reset"
              variant="secondary"
              onClick={reset}
              disabled={isDemo}
            >
              {t("clear")}
            </Button>
            <div className="flex flex-col items-end gap-2">
              <AcceptTermsOfService legal={legal} />
              <div className="flex items-center gap-2">
                <div className="text-muted-foreground text-sm">
                  {t("price", {
                    price: isDemo
                      ? 0
                      : convertCentsToCredits(creditsPrice.cents),
                  })}
                </div>
                <Button
                  type="submit"
                  disabled={loading || isSubmitting || !isValid}
                  className="items-center justify-between gap-1"
                >
                  <div className="flex items-center gap-1">
                    {(loading || isSubmitting) && (
                      <Loader2 className="size-4 animate-spin" />
                    )}
                    {isScheduled ? t("schedule") : t("submit")}
                  </div>
                  {!isDemo &&
                    averageExecutionDuration &&
                    averageExecutionDuration > 0 && (
                      <span>{`(~${formattedDuration})`}</span>
                    )}
                  {!isMobile && (
                    <div className="flex items-center gap-1">
                      {os === "MacOS" ? <Command /> : t("ctrl")}
                      <CornerDownLeft />
                    </div>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setScheduleOpen(true)}
                >
                  <CalendarClock />
                </Button>
              </div>
            </div>
          </div>
        </>
      );
    },
    [
      isScheduled,
      nextRunLabel,
      t,
      isDemo,
      legal,
      creditsPrice.cents,
      loading,
      averageExecutionDuration,
      formattedDuration,
      isMobile,
      os,
      setScheduleOpen,
    ],
  );

  const flatDefaultValues = useMemo(
    () => (demoValues ? demoValues.input : defaultValues(flatInputs)),
    [demoValues, flatInputs],
  );

  return (
    <>
      <JobInputsFormBuilder
        inputFields={flatInputs}
        defaultValues={flatDefaultValues}
        onSubmit={handleFlatSubmit}
        renderFooter={renderFlatFooter}
        className={cn("min-w-0", className)}
        disabled={loading}
        isActive={open}
        t={t}
        inputsDisabled={isDemo}
        preventEnterSubmit
      />
      <JobScheduleModal
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        selection={scheduleSelection}
        timezoneOptions={timezoneOptions}
        onSave={(sel: JobScheduleSelectionType) => {
          setScheduleSelection(sel);
          setScheduleOpen(false);
        }}
        onCancel={() => setScheduleOpen(false)}
      />
    </>
  );
}

// Custom mode component (e.g., provide input)
function JobInputsFlatFormCustom({
  flatInputs,
  className,
  customOnSubmit,
  customRenderFooter,
  customIsSubmitting,
  customIsActive,
}: CustomModeProps) {
  const t = useTranslations("Library.JobInput.Form");

  const handleFlatSubmit = useCallback(
    (values: JobInputsFormSchemaType) => {
      customOnSubmit(values);
    },
    [customOnSubmit],
  );

  const flatDefaultValues = useMemo(
    () => defaultValues(flatInputs),
    [flatInputs],
  );

  return (
    <JobInputsFormBuilder
      inputFields={flatInputs}
      defaultValues={flatDefaultValues}
      onSubmit={handleFlatSubmit}
      renderFooter={customRenderFooter}
      className={cn("min-w-0", className)}
      disabled={customIsSubmitting}
      isActive={customIsActive}
      t={t}
      preventEnterSubmit
    />
  );
}
