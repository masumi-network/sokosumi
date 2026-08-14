"use client";

import type { InputGroupSchemaType } from "@sokosumi/masumi/schemas";
import { useTranslations } from "next-intl";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

import { GroupedInputTabs } from "@/components/common/grouped-input-tabs";
import { defaultValues, type JobInputsFormSchemaType } from "@/lib/job-input";
import { cn } from "@/lib/utils";

import {
  type FormFooterProps,
  JobInputsFormBuilder,
} from "./job-inputs-form-builder";

interface JobInputsGroupedFormProps {
  groups: InputGroupSchemaType[];
  className?: string;
  activeGroupIndex: number;
  maxUnlockedGroupIndex: number;
  goToNext: () => void;
  goBack: () => void;
  goToGroup: (index: number) => void;
  reset: () => void;
  resetMaxUnlockedTo: (index: number) => void;
  customOnSubmit: (values: JobInputsFormSchemaType) => void | Promise<void>;
  customRenderGroupFooter: (
    props: FormFooterProps,
    isLast: boolean,
    groupIndex: number,
  ) => React.ReactNode;
  customIsSubmitting: boolean;
  customIsActive: boolean;
}

export function JobInputsGroupedForm({
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
}: JobInputsGroupedFormProps) {
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

  const handleGroupValuesChange = useCallback(
    (groupValues: JobInputsFormSchemaType) => {
      setCollectedGroupValues((prev) => ({ ...prev, ...groupValues }));
    },
    [],
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
          onValuesChange={handleGroupValuesChange}
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
