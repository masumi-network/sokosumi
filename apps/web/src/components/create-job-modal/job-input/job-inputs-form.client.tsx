"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AgentWithCreditsPrice } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";
import { track } from "@vercel/analytics";
import {
  CalendarClock,
  Clock,
  Command,
  CornerDownLeft,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import React from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import { toast } from "sonner";

import { useCreateJobModalContext } from "@/components/create-job-modal";
import { JobScheduleModal } from "@/components/create-job-modal/job-schedule-modal";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
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
import {
  defaultValues,
  filterOutNullValues,
  JobInputDataSchemaType,
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
  inputDataSchema: JobInputDataSchemaType;
  demoValues: AgentDemoValues | null;
  legal: AgentLegal | null;
  className?: string | undefined;
}

export default function JobInputsFormClient({
  agent,
  averageExecutionDuration,
  inputDataSchema,
  demoValues,
  legal,
  className,
}: JobInputsFormClientProps) {
  const { id: agentId, creditsPrice } = agent;
  const { input_data } = inputDataSchema;
  const t = useTranslations("Library.JobInput.Form");
  const tDuration = useTranslations("Library.Duration.Short");
  const formatter = useFormatter();
  const session = useSession();

  const form = useForm<JobInputsFormSchemaType>({
    resolver: zodResolver(jobInputsFormSchema(input_data, t)),
    defaultValues: demoValues ? demoValues.input : defaultValues(input_data),
    mode: "onChange",
  });
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
          inputSchema: input_data,
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
          inputSchema: input_data,
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
          inputSchema: input_data,
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

  return (
    <Form {...form}>
      <form ref={formRef} onSubmit={enterPreventedHandleSubmit}>
        <fieldset
          disabled={loading || isSubmitting}
          className={cn("flex flex-1 flex-col gap-6", className)}
        >
          {input_data.map((jobInputSchema) => (
            <JobInput
              key={jobInputSchema.id}
              form={form}
              jobInputSchema={jobInputSchema}
              disabled={isDemo}
            />
          ))}
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
              onClick={handleClear}
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
              </div>
            </div>
          </div>
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
