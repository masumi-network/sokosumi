"use client";

import { AgentWithCreditsPrice } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";
import { InputSchemaSchemaType } from "@sokosumi/masumi/schemas";
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
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { GroupedInputTabs } from "@/components/common/grouped-input-tabs";
import { useCreateJobModalContext } from "@/components/create-job-modal";
import { JobScheduleModal } from "@/components/create-job-modal/job-schedule-modal";
import { Button } from "@/components/ui/button";
import { useInputs } from "@/hooks/use-inputs";
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
  JobInputsFormSchemaType,
} from "@/lib/job-input";
import { AgentDemoValues, AgentLegal } from "@/lib/types/agent";
import { JobScheduleSelectionType, JobScheduleType } from "@/lib/types/job";
import { cn, formatDuration, getOSFromUserAgent } from "@/lib/utils";
import { computeNextRun } from "@/lib/utils/cron";

import {
  FormFooterProps,
  JobInputsFormBuilder,
} from "./job-inputs-form-builder";

interface JobInputsFormClientProps {
  agent: AgentWithCreditsPrice;
  averageExecutionDuration: number;
  inputSchema: InputSchemaSchemaType;
  demoValues: AgentDemoValues | null;
  legal: AgentLegal | null;
  className?: string | undefined;
}

export default function JobInputsFormClient({
  agent,
  averageExecutionDuration,
  inputSchema,
  demoValues,
  legal,
  className,
}: JobInputsFormClientProps) {
  const { id: agentId, creditsPrice } = agent;
  const t = useTranslations("Library.JobInput.Form");
  const tDuration = useTranslations("Library.Duration.Short");
  const formatter = useFormatter();
  const session = useSession();
  const router = useRouter();

  const { os, isMobile } = getOSFromUserAgent();

  const { open, loading, setLoading, handleClose } = useCreateJobModalContext();

  const inputs = useInputs({ inputSchema });

  const [accumulatedValues, setAccumulatedValues] =
    useState<JobInputsFormSchemaType>({});

  const resetInputs = useRef(inputs.reset);
  resetInputs.current = inputs.reset;

  useEffect(() => {
    setAccumulatedValues({});
    resetInputs.current();
  }, [inputSchema]);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleSelection, setScheduleSelection] =
    useState<JobScheduleSelectionType | null>(null);
  const timezoneOptions =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [Intl.DateTimeFormat().resolvedOptions().timeZone];

  const formattedDuration = formatDuration(averageExecutionDuration, tDuration);
  const isDemo = !!demoValues;

  const isScheduled = useMemo(() => {
    return (
      !!scheduleSelection && scheduleSelection.mode !== JobScheduleType.NOW
    );
  }, [scheduleSelection]);

  const nextRunAt: Date | null = useMemo(() => {
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

  const nextRunLabel = useMemo(() => {
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

  const handleFinalSubmit = useCallback(
    async (allValues: JobInputsFormSchemaType) => {
      setLoading(true);

      let result:
        | { ok: true; data: { jobId: string; scheduleId?: string } }
        | { ok: false; error: { code: string } };

      const transformedInputData = filterOutNullValues(allValues);

      if (demoValues) {
        result = await startDemoJob({
          input: {
            agentId: agentId,
            inputSchema: inputs.flatInputs,
            inputData: filterOutNullValues(demoValues.input),
          },
          jobStatusResponse: demoValues.output,
        });
      } else if (
        scheduleSelection &&
        scheduleSelection.mode !== JobScheduleType.NOW
      ) {
        if (!session.data) {
          result = {
            ok: false,
            error: { code: CommonErrorCode.UNAUTHENTICATED },
          };
          setLoading(false);
          return;
        }

        result = await createSchedule({
          input: {
            agentId: agentId,
            inputSchema: inputs.flatInputs,
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
            inputSchema: inputs.flatInputs,
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
        handleClose();
        if (result.data?.scheduleId) {
          router.push(`/schedules`);
        } else {
          router.push(`/agents/${agentId}/jobs/${result.data.jobId}`);
        }
      } else {
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
    },
    [
      setLoading,
      demoValues,
      scheduleSelection,
      agent,
      agentId,
      creditsPrice.cents,
      inputs.flatInputs,
      session.data,
      handleClose,
      router,
      t,
    ],
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

      formReset();

      const groupFieldIds = group.input_data.map((field) => field.id);

      setAccumulatedValues((prev) => {
        const filtered = Object.fromEntries(
          Object.entries(prev).filter(([key]) => !groupFieldIds.includes(key)),
        );
        return filtered;
      });

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

      const demoOrDefaults = demoValues
        ? Object.fromEntries(
            Object.entries(demoValues.input).filter(([key]) =>
              groupFieldIds.includes(key),
            ),
          )
        : defaultValues(group.input_data);

      return { ...demoOrDefaults, ...fromAccumulated };
    },
    [inputs.groups, accumulatedValues, demoValues],
  );

  const renderGroupFooter = useCallback(
    (props: FormFooterProps, isLast: boolean, groupIndex: number) => {
      const { isSubmitting, isValid, reset } = props;
      const isFirst = groupIndex === 0;

      return (
        <>
          {isScheduled && nextRunLabel && isLast && (
            <div className="text-muted-foreground inline-flex items-center gap-1 text-sm">
              <Clock className="size-4" />
              {nextRunLabel}
            </div>
          )}
          <div className="flex items-end justify-between gap-2">
            <div className="flex items-center gap-2">
              {!isFirst && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={inputs.goBack}
                >
                  <ArrowLeft className="size-4" />
                  {t("back")}
                </Button>
              )}
              <Button
                type="reset"
                variant="secondary"
                onClick={() => handleGroupClear(groupIndex, reset)}
                disabled={isDemo}
              >
                {t("clear")}
              </Button>
            </div>
            <div className="flex flex-col items-end gap-2">
              {isLast && <AcceptTermsOfService legal={legal} />}
              <div className="flex items-center gap-2">
                {isLast && (
                  <div className="text-muted-foreground text-sm">
                    {t("price", {
                      price: isDemo
                        ? 0
                        : convertCentsToCredits(creditsPrice.cents),
                    })}
                  </div>
                )}
                {isLast ? (
                  <>
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
                  <Button type="submit" disabled={isSubmitting || !isValid}>
                    {isSubmitting && (
                      <Loader2 className="size-4 animate-spin" />
                    )}
                    {t("next")}
                    <ArrowRight className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      );
    },
    [
      isScheduled,
      nextRunLabel,
      inputs,
      t,
      isDemo,
      legal,
      creditsPrice.cents,
      loading,
      averageExecutionDuration,
      formattedDuration,
      isMobile,
      os,
      handleGroupClear,
    ],
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
    ],
  );

  const flatDefaultValues = useMemo(
    () => (demoValues ? demoValues.input : defaultValues(inputs.flatInputs)),
    [demoValues, inputs.flatInputs],
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

  return (
    <>
      {inputs.isGrouped && inputs.groups ? (
        <GroupedInputTabs
          groups={inputs.groups}
          activeGroupIndex={inputs.activeGroupIndex}
          maxUnlockedGroupIndex={inputs.maxUnlockedGroupIndex}
          onTabChange={handleTabChange}
          className={cn("min-w-0", className)}
          renderGroup={(group, index, isLast) => (
            <JobInputsFormBuilder
              key={group.id}
              inputFields={group.input_data}
              defaultValues={getGroupDefaultValues(index)}
              onSubmit={isLast ? handleGroupSubmit : handleGroupNext}
              renderFooter={(props) => renderGroupFooter(props, isLast, index)}
              disabled={loading}
              isActive={open && inputs.activeGroupIndex === index}
              t={t}
              inputsDisabled={isDemo}
              preventEnterSubmit={isLast}
            />
          )}
        />
      ) : (
        <JobInputsFormBuilder
          inputFields={inputs.flatInputs}
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
      )}
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
