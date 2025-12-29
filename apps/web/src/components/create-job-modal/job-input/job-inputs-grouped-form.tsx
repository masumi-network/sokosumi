"use client";

import { AgentWithCreditsPrice } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";
import type {
  InputFieldSchemaType,
  InputGroupSchemaType,
} from "@sokosumi/masumi/schemas";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Clock,
  Command,
  CornerDownLeft,
  Loader2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback, useMemo, useState } from "react";

import { GroupedInputTabs } from "@/components/common/grouped-input-tabs";
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

interface CommonGroupedFormProps {
  groups: InputGroupSchemaType[];
  className?: string;
  // Navigation state from useInputs hook
  activeGroupIndex: number;
  maxUnlockedGroupIndex: number;
  goToNext: () => void;
  goBack: () => void;
  goToGroup: (index: number) => void;
  reset: () => void;
  resetMaxUnlockedTo: (index: number) => void;
}

interface StandardModeProps extends CommonGroupedFormProps {
  agent: AgentWithCreditsPrice;
  averageExecutionDuration: number | null;
  flatInputs: InputFieldSchemaType[];
  demoValues: AgentDemoValues | null;
  legal: AgentLegal | null;
  customOnSubmit?: undefined;
  customRenderGroupFooter?: undefined;
  customIsSubmitting?: undefined;
  customIsActive?: undefined;
}

interface CustomModeProps extends CommonGroupedFormProps {
  customOnSubmit: (values: JobInputsFormSchemaType) => void | Promise<void>;
  customRenderGroupFooter: (
    props: FormFooterProps,
    isLast: boolean,
    groupIndex: number,
  ) => React.ReactNode;
  customIsSubmitting: boolean;
  customIsActive: boolean;
  agent?: undefined;
  averageExecutionDuration?: undefined;
  flatInputs?: undefined;
  demoValues?: undefined;
  legal?: undefined;
}

type JobInputsGroupedFormProps = StandardModeProps | CustomModeProps;

function isCustomMode(
  props: JobInputsGroupedFormProps,
): props is CustomModeProps {
  return props.customOnSubmit !== undefined;
}

export function JobInputsGroupedForm(props: JobInputsGroupedFormProps) {
  if (isCustomMode(props)) {
    return <JobInputsGroupedFormCustom {...props} />;
  }

  return <JobInputsGroupedFormStandard {...props} />;
}

function JobInputsGroupedFormStandard({
  agent,
  averageExecutionDuration,
  groups,
  flatInputs,
  demoValues,
  legal,
  className,
  activeGroupIndex,
  maxUnlockedGroupIndex,
  goToNext,
  goBack,
  goToGroup,
  reset,
  resetMaxUnlockedTo,
}: StandardModeProps) {
  const { creditsPrice } = agent;
  const t = useTranslations("Library.JobInput.Form");
  const tDuration = useTranslations("Library.Duration.Short");

  const { os, isMobile } = getOSFromUserAgent();

  const { open, loading, setLoading, handleClose } = useCreateJobModalContext();

  const groupsKey = useMemo(() => groups.map((g) => g.id).join(","), [groups]);
  const [collectedGroupValues, setCollectedGroupValues] =
    useState<JobInputsFormSchemaType>({});
  const [prevGroupsKey, setPrevGroupsKey] = useState(groupsKey);

  if (prevGroupsKey !== groupsKey) {
    setPrevGroupsKey(groupsKey);
    setCollectedGroupValues({});
    reset();
  }

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

  const handleGroupNext = useCallback(
    (groupValues: JobInputsFormSchemaType) => {
      setCollectedGroupValues((prev) => ({ ...prev, ...groupValues }));
      goToNext();
    },
    [goToNext],
  );

  const handleGroupSubmit = useCallback(
    (lastGroupValues: JobInputsFormSchemaType) => {
      const allValues = { ...collectedGroupValues, ...lastGroupValues };
      handleSubmit(allValues);
    },
    [collectedGroupValues, handleSubmit],
  );

  const handleGroupClear = useCallback(
    (groupIndex: number, formReset: () => void) => {
      const group = groups[groupIndex];
      if (!group) return;

      formReset();

      const groupFieldIds = group.input_data.map((field) => field.id);

      setCollectedGroupValues((prev) => {
        const filtered = Object.fromEntries(
          Object.entries(prev).filter(([key]) => !groupFieldIds.includes(key)),
        );
        return filtered;
      });

      if (groupIndex === 0) {
        setCollectedGroupValues({});
        reset();
      } else {
        resetMaxUnlockedTo(groupIndex);
      }
    },
    [groups, reset, resetMaxUnlockedTo],
  );

  const getGroupDefaultValues = useCallback(
    (groupIndex: number) => {
      const group = groups[groupIndex];
      if (!group) return {};

      const groupFieldIds = group.input_data.map((field) => field.id);

      const fromAccumulated = Object.fromEntries(
        Object.entries(collectedGroupValues).filter(([key]) =>
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
    [groups, collectedGroupValues, demoValues],
  );

  const renderGroupFooter = useCallback(
    (props: FormFooterProps, isLast: boolean, groupIndex: number) => {
      const { isSubmitting, isValid, reset: formReset } = props;
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
                <Button type="button" variant="secondary" onClick={goBack}>
                  <ArrowLeft className="size-4" />
                  {t("back")}
                </Button>
              )}
              <Button
                type="reset"
                variant="secondary"
                onClick={() => handleGroupClear(groupIndex, formReset)}
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
      goBack,
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
      setScheduleOpen,
    ],
  );

  const handleTabChange = useCallback(
    (groupId: string) => {
      const index = groups.findIndex((g) => g.id === groupId);
      if (index >= 0) {
        goToGroup(index);
      }
    },
    [groups, goToGroup],
  );

  return (
    <>
      <GroupedInputTabs
        groups={groups}
        activeGroupIndex={activeGroupIndex}
        maxUnlockedGroupIndex={maxUnlockedGroupIndex}
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
            isActive={open && activeGroupIndex === index}
            t={t}
            inputsDisabled={isDemo}
            preventEnterSubmit={isLast}
          />
        )}
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

function JobInputsGroupedFormCustom({
  groups,
  className,
  activeGroupIndex,
  maxUnlockedGroupIndex,
  goToNext,
  goBack: _goBack,
  goToGroup,
  reset,
  resetMaxUnlockedTo: _resetMaxUnlockedTo,
  customOnSubmit,
  customRenderGroupFooter,
  customIsSubmitting,
  customIsActive,
}: CustomModeProps) {
  const t = useTranslations("Library.JobInput.Form");

  const groupsKey = useMemo(() => groups.map((g) => g.id).join(","), [groups]);
  const [collectedGroupValues, setCollectedGroupValues] =
    useState<JobInputsFormSchemaType>({});
  const [prevGroupsKey, setPrevGroupsKey] = useState(groupsKey);

  if (prevGroupsKey !== groupsKey) {
    setPrevGroupsKey(groupsKey);
    setCollectedGroupValues({});
    reset();
  }

  const handleGroupNext = useCallback(
    (groupValues: JobInputsFormSchemaType) => {
      setCollectedGroupValues((prev) => ({ ...prev, ...groupValues }));
      goToNext();
    },
    [goToNext],
  );

  const handleGroupSubmit = useCallback(
    (lastGroupValues: JobInputsFormSchemaType) => {
      const allValues = { ...collectedGroupValues, ...lastGroupValues };
      customOnSubmit(allValues);
    },
    [collectedGroupValues, customOnSubmit],
  );

  const getGroupDefaultValues = useCallback(
    (groupIndex: number) => {
      const group = groups[groupIndex];
      if (!group) return {};

      const groupFieldIds = group.input_data.map((field) => field.id);

      const fromAccumulated = Object.fromEntries(
        Object.entries(collectedGroupValues).filter(([key]) =>
          groupFieldIds.includes(key),
        ),
      );

      const defaults = defaultValues(group.input_data);

      return { ...defaults, ...fromAccumulated };
    },
    [groups, collectedGroupValues],
  );

  const handleTabChange = useCallback(
    (groupId: string) => {
      const index = groups.findIndex((g) => g.id === groupId);
      if (index >= 0) {
        goToGroup(index);
      }
    },
    [groups, goToGroup],
  );

  return (
    <GroupedInputTabs
      groups={groups}
      activeGroupIndex={activeGroupIndex}
      maxUnlockedGroupIndex={maxUnlockedGroupIndex}
      onTabChange={handleTabChange}
      className={cn("min-w-0", className)}
      renderGroup={(group, index, isLast) => (
        <JobInputsFormBuilder
          key={group.id}
          inputFields={group.input_data}
          defaultValues={getGroupDefaultValues(index)}
          onSubmit={isLast ? handleGroupSubmit : handleGroupNext}
          renderFooter={(props) =>
            customRenderGroupFooter(props, isLast, index)
          }
          disabled={customIsSubmitting}
          isActive={customIsActive && activeGroupIndex === index}
          t={t}
          preventEnterSubmit={isLast}
        />
      )}
    />
  );
}
