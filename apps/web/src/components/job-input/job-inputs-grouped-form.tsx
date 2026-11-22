"use client";

import type { InputGroupSchemaType } from "@sokosumi/masumi/schemas";
import { useTranslations } from "next-intl";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";

import { GroupedInputTabs } from "@/components/common/grouped-input-tabs";
import {
  defaultValues,
  type JobInputsFormSchemaType,
} from "@/lib/job-input/form";
import { cn } from "@/lib/utils";

import {
  type FormFooterProps,
  JobInputsFormBuilder,
  type JobInputsFormBuilderHandle,
} from "./job-inputs-form-builder";

interface JobInputsGroupedFormProps {
  groups: InputGroupSchemaType[];
  className?: string;
  activeGroupIndex: number;
  maxUnlockedGroupIndex: number;
  goToNext: () => void;
  goToGroup: (index: number) => void;
  reset: () => void;
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
  goToGroup,
  reset,
  customOnSubmit,
  customRenderGroupFooter,
  customIsSubmitting,
  customIsActive,
}: JobInputsGroupedFormProps) {
  const t = useTranslations("Library.JobInput.Form");

  const groupsKey = useMemo(() => groups.map((g) => g.id).join(","), [groups]);
  const groupHandlesRef = useRef(new Map<string, JobInputsFormBuilderHandle>());
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
      const mountedValues: JobInputsFormSchemaType = {};
      for (const group of groups) {
        const handle = groupHandlesRef.current.get(group.id);
        if (handle) {
          Object.assign(mountedValues, handle.getValues());
        }
      }
      const allValues = {
        ...collectedGroupValues,
        ...mountedValues,
        ...lastGroupValues,
      };
      customOnSubmit(allValues);
    },
    [collectedGroupValues, customOnSubmit, groups],
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
      const currentGroup = groups[activeGroupIndex];
      const currentHandle = currentGroup
        ? groupHandlesRef.current.get(currentGroup.id)
        : undefined;
      if (currentHandle) {
        const snapshot = currentHandle.getValues();
        setCollectedGroupValues((prev) => ({ ...prev, ...snapshot }));
      }
      const index = groups.findIndex((g) => g.id === groupId);
      if (index >= 0) {
        goToGroup(index);
      }
    },
    [activeGroupIndex, groups, goToGroup],
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
          ref={(handle) => {
            if (handle) {
              groupHandlesRef.current.set(group.id, handle);
            } else {
              groupHandlesRef.current.delete(group.id);
            }
          }}
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
