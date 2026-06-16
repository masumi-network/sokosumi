"use client";

import type {
  InputFieldSchemaType,
  InputSchemaSchemaType,
} from "@sokosumi/masumi/schemas";
import type { AgentWithCreditsPrice } from "@sokosumi/utils";
import { convertCentsToCredits } from "@sokosumi/utils";
import { Command, CornerDownLeft, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type React from "react";
import { useCallback, useMemo } from "react";

import { useCreateJobModalContext } from "@/components/create-job-modal";
import { Button } from "@/components/ui/button";
import { useJobSubmission } from "@/hooks/use-job-submission";
import { useOSDetection } from "@/hooks/use-os-detection";
import { defaultValues, type JobInputsFormSchemaType } from "@/lib/job-input";
import type { AgentDemoValues, AgentLegal } from "@/lib/types/agent";
import { cn, formatDuration } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

import { AcceptTermsOfService } from "./accept-terms-of-service";
import {
  type FormFooterProps,
  JobInputsFormBuilder,
} from "./job-inputs-form-builder";

// Props for standard create job modal mode
interface StandardModeProps {
  agent: AgentWithCreditsPrice;
  averageExecutionDuration: number | null;
  flatInputs: InputFieldSchemaType[];
  inputSchema: InputSchemaSchemaType;
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
  inputSchema,
  demoValues,
  legal,
  className,
}: StandardModeProps) {
  const { creditsPrice } = agent;
  const t = useTranslations("Library.JobInput.Form");
  const tDuration = useTranslations("Library.Duration.Short");
  const { os, isMobile } = useOSDetection();

  const { open, loading, setLoading, handleClose, projectId } =
    useCreateJobModalContext();

  const { handleSubmit } = useJobSubmission({
    agent,
    inputSchema,
    demoValues,
    projectId,
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
                      : formatCreditsForDisplay(
                          convertCentsToCredits(creditsPrice.cents),
                        ),
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
                    {t("submit")}
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
              </div>
            </div>
          </div>
        </>
      );
    },
    [
      t,
      isDemo,
      legal,
      creditsPrice.cents,
      loading,
      averageExecutionDuration,
      formattedDuration,
      isMobile,
      os,
    ],
  );

  const flatDefaultValues = useMemo(
    () => (demoValues ? demoValues.input : defaultValues(flatInputs)),
    [demoValues, flatInputs],
  );

  return (
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
