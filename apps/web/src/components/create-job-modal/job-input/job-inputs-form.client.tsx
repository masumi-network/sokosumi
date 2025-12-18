"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AgentWithCreditsPrice } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";
import { InputEnvelope, InputSchemaType } from "@sokosumi/masumi/schemas";
import { track } from "@vercel/analytics";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Clock,
  Command,
  CornerDownLeft,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import React, { useMemo } from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import { toast } from "sonner";

import { GroupedInputTabs } from "@/components/common/grouped-input-tabs";
import { useCreateJobModalContext } from "@/components/create-job-modal";
import { JobScheduleModal } from "@/components/create-job-modal/job-schedule-modal";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { useGroupedInputWizard } from "@/hooks/use-grouped-input-wizard";
import usePreventEnterSubmit from "@/hooks/use-prevent-enter-submit";
import {
  CommonErrorCode,
  JobErrorCode,
  startDemoJob,
  startJob,
} from "@/lib/actions";
import { createSchedule } from "@/lib/actions/job-schedule";
import { useSession } from "@/lib/auth/auth.client";
import { fireGTMEvent } from "@/lib/gtm-events";
import { getAgentName } from "@/lib/helpers/agent";
import { flattenInputs } from "@/lib/helpers/input-schema";
import {
  defaultValues,
  filterOutNullValues,
  jobInputsFormSchema,
  JobInputsFormSchemaType,
} from "@/lib/job-input";
import { AgentDemoValues, AgentLegal } from "@/lib/types/agent";
import { JobScheduleSelectionType, JobScheduleType } from "@/lib/types/job";
import { cn, formatDuration, getOSFromUserAgent } from "@/lib/utils";
import { computeNextRun } from "@/lib/utils/cron";

import JobInput from "./job-input";

interface JobInputsFormClientProps {
  agent: AgentWithCreditsPrice;
  averageExecutionDuration: number;
  inputEnvelope: InputEnvelope;
  demoValues: AgentDemoValues | null;
  legal: AgentLegal | null;
  className?: string | undefined;
}

export default function JobInputsFormClient({
  agent,
  averageExecutionDuration,
  inputEnvelope,
  demoValues,
  legal,
  className,
}: JobInputsFormClientProps) {
  const { id: agentId, creditsPrice } = agent;
  const t = useTranslations("Library.JobInput.Form");
  const tDuration = useTranslations("Library.Duration.Short");
  const formatter = useFormatter();
  const session = useSession();

  // Flatten inputs for form initialization (before wizard hook)
  const flatInputsForForm = useMemo(
    () => flattenInputs(inputEnvelope),
    [inputEnvelope],
  );

  // Initialize form first so we can pass it to the wizard hook
  const form = useForm<JobInputsFormSchemaType>({
    resolver: zodResolver(jobInputsFormSchema(flatInputsForForm, t)),
    defaultValues: demoValues
      ? demoValues.input
      : defaultValues(flatInputsForForm),
    mode: "onChange",
  });

  // Use the wizard hook for grouped input navigation
  const wizard = useGroupedInputWizard({ inputEnvelope, form });

  const router = useRouter();

  const { os, isMobile } = getOSFromUserAgent();

  // create job modal context
  const { open, loading, setLoading, handleClose } = useCreateJobModalContext();

  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [scheduleSelection, setScheduleSelection] =
    React.useState<JobScheduleSelectionType | null>(null);
  const timezoneOptions =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [Intl.DateTimeFormat().resolvedOptions().timeZone];

  const handleSubmit: SubmitHandler<JobInputsFormSchemaType> = async (
    values,
  ) => {
    setLoading(true);

    let result:
      | { ok: true; data: { jobId: string; scheduleId?: string } }
      | { ok: false; error: { code: string } };
    // Transform input data to match expected type
    // Filter out null values and ensure arrays are of correct type
    const transformedInputData = filterOutNullValues(values);

    if (demoValues) {
      result = await startDemoJob({
        input: {
          agentId: agentId,
          inputSchema: wizard.flatInputs,
          inputData: filterOutNullValues(demoValues.input),
        },
        jobStatusResponse: demoValues.output,
      });
    } else if (
      scheduleSelection &&
      scheduleSelection.mode !== JobScheduleType.NOW
    ) {
      // Schedule instead of immediate run
      if (!session.data) {
        result = {
          ok: false,
          error: { code: CommonErrorCode.UNAUTHENTICATED },
        };
        return;
      }

      result = await createSchedule({
        input: {
          agentId: agentId,
          inputSchema: wizard.flatInputs,
          inputData: transformedInputData,
          maxAcceptedCents: creditsPrice.cents,
        },
        scheduleSelection: scheduleSelection,
      });
    } else {
      result = await startJob({
        input: {
          agentId: agentId,
          maxAcceptedCents: creditsPrice.cents,
          inputSchema: wizard.flatInputs,
          inputData: transformedInputData,
        },
      });
    }

    setLoading(false);
    if (result.ok) {
      fireGTMEvent.agentHired(
        getAgentName(agent),
        convertCentsToCredits(creditsPrice.cents),
      );
      track("Agent hired", {
        agentId: agentId,
        credits: convertCentsToCredits(creditsPrice.cents),
        jobId: result.data.jobId,
      });
      // close modal
      handleClose();
      if (result.data?.scheduleId) {
        router.push(`/schedules`);
      } else {
        router.push(`/agents/${agentId}/jobs/${result.data.jobId}`);
      }
    } else {
      console.log("result", result);
      console.log("scheduleSelection", scheduleSelection);
      switch (result.error.code) {
        case CommonErrorCode.UNAUTHENTICATED:
          toast.error(t("Error.unauthenticated"), {
            action: {
              label: t("Error.unauthenticatedAction"),
              onClick: () => router.push(`/login`),
            },
          });
          break;
        case CommonErrorCode.BAD_INPUT:
          toast.error(t("Error.badInput"));
          break;
        case JobErrorCode.INSUFFICIENT_BALANCE:
          toast.error(t("Error.insufficientBalance"), {
            action: {
              label: t("Error.insufficientBalanceAction"),
              onClick: () => router.push(`/credits`),
            },
          });
          break;
        default:
          toast.error(t("Error.default"));
          break;
      }
    }
  };

  const { formRef, handleSubmit: enterPreventedHandleSubmit } =
    usePreventEnterSubmit(form, handleSubmit, open);

  const handleClear = () => {
    form.reset();
  };

  const { isSubmitting, isValid } = form.formState;
  const formattedDuration = formatDuration(averageExecutionDuration, tDuration);
  const isDemo = !!demoValues;

  // Derived: is scheduled and next run label
  const isScheduled = React.useMemo(() => {
    return (
      !!scheduleSelection && scheduleSelection.mode !== JobScheduleType.NOW
    );
  }, [scheduleSelection]);

  const nextRunAt: Date | null = React.useMemo(() => {
    if (!scheduleSelection) return null;
    if (scheduleSelection.mode === JobScheduleType.ONE_TIME) {
      if (!scheduleSelection.oneTimeLocalIso) return null;
      const parsed = new Date(scheduleSelection.oneTimeLocalIso);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (scheduleSelection.mode === JobScheduleType.CRON) {
      if (!scheduleSelection.cron) return null;
      return (
        computeNextRun({
          cron: scheduleSelection.cron,
          timezone: scheduleSelection.timezone,
        }) ?? null
      );
    }
    return null;
  }, [scheduleSelection]);

  const nextRunLabel = React.useMemo(() => {
    if (!nextRunAt || !scheduleSelection) return null;
    try {
      return formatter.dateTime(nextRunAt, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: scheduleSelection.timezone,
      });
    } catch {
      return nextRunAt.toLocaleString();
    }
  }, [nextRunAt, scheduleSelection, formatter]);

  // Render inputs for the current group (or all inputs if flat)
  const renderInputs = (inputs: InputSchemaType[]) => {
    return inputs.map((jobInputSchema) => (
      <JobInput
        key={jobInputSchema.id}
        form={form}
        jobInputSchema={jobInputSchema}
        disabled={isDemo}
      />
    ));
  };

  // Render the form footer with action buttons
  const renderFormFooter = (showSubmit: boolean) => (
    <>
      {isScheduled && nextRunLabel && (
        <div className="text-muted-foreground inline-flex items-center gap-1 text-sm">
          <Clock className="size-4" />
          {nextRunLabel}
        </div>
      )}
      <div className="flex items-end justify-between gap-2">
        {wizard.isGrouped && !wizard.isFirstGroup ? (
          <Button
            type="button"
            variant="secondary"
            onClick={wizard.handleBack}
            disabled={wizard.isValidating}
          >
            <ArrowLeft className="size-4" />
            {t("back")}
          </Button>
        ) : (
          <Button
            type="reset"
            variant="secondary"
            onClick={handleClear}
            disabled={isDemo}
          >
            {t("clear")}
          </Button>
        )}
        <div className="flex flex-col items-end gap-2">
          {showSubmit && <AcceptTermsOfService legal={legal} />}
          <div className="flex items-center gap-2">
            {showSubmit && (
              <div className="text-muted-foreground text-sm">
                {t("price", {
                  price: isDemo ? 0 : convertCentsToCredits(creditsPrice.cents),
                })}
              </div>
            )}
            {showSubmit ? (
              <>
                <Button
                  type="submit"
                  disabled={loading || isSubmitting || !isValid}
                  className="items-center justify-between gap-1"
                >
                  <div className="flex items-center gap-1">
                    {(loading || isSubmitting) && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {isScheduled ? t("schedule") : t("submit")}
                  </div>
                  {!isDemo && averageExecutionDuration > 0 && (
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
              </>
            ) : (
              <Button
                type="button"
                onClick={wizard.handleNext}
                disabled={wizard.isValidating || !wizard.isCurrentGroupValid}
              >
                {wizard.isValidating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {t("next")}
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );

  return (
    <Form {...form}>
      <form ref={formRef} onSubmit={enterPreventedHandleSubmit}>
        <fieldset
          disabled={loading || isSubmitting}
          className={cn("flex flex-1 flex-col gap-6", className)}
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
    </Form>
  );
}

function AcceptTermsOfService({
  legal,
}: {
  legal?: AgentLegal | null | undefined;
}) {
  const t = useTranslations("Library.JobInput.Form");

  if (!legal) {
    return null;
  }

  const legalLinks = filterLegalLinks(legal, t);

  return (
    <div className="text-muted-foreground text-right text-xs">
      <span>{t("acceptByClickingSubmit")}</span>
      {legalLinks.map((legalLink, index) => (
        <React.Fragment key={index}>
          <Link
            target="_blank"
            href={legalLink.href}
            className="text-foreground"
          >
            <span>{legalLink.label}</span>
          </Link>
          {index < legalLinks.length - 1 && ", "}
        </React.Fragment>
      ))}

      <span>{t("byCreator")}</span>
    </div>
  );
}

function filterLegalLinks(
  legal: AgentLegal,
  t: IntlTranslation<"Library.JobInput.Form">,
) {
  return [
    {
      href: legal?.terms,
      label: t("termsOfService"),
    },
    {
      href: legal?.privacyPolicy,
      label: t("privacyPolicy"),
    },
    {
      href: legal?.other,
      label: t("legal"),
    },
  ].filter((legalLink) => !!legalLink.href) as {
    href: string;
    label: string;
  }[];
}
