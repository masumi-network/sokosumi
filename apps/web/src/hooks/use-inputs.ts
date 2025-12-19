"use client";

import type {
  InputFieldSchemaType,
  InputGroupSchemaType,
  InputSchemaSchemaType,
} from "@sokosumi/masumi/schemas";
import { useCallback, useMemo, useState } from "react";

import { flattenInputs, isGroupedSchema } from "@/lib/schemas/job";

interface UseInputsOptions {
  inputSchema: InputSchemaSchemaType;
}

export interface UseInputsReturn {
  isGrouped: boolean;
  groups: InputGroupSchemaType[] | null;
  flatInputs: InputFieldSchemaType[];
  totalGroups: number;
  activeGroupIndex: number;
  maxUnlockedGroupIndex: number;
  isFirstGroup: boolean;
  isLastGroup: boolean;
  currentGroup: InputGroupSchemaType | null;
  goToNext: () => void;
  goBack: () => void;
  goToGroup: (index: number) => void;
  reset: () => void;
}

export function useInputs({ inputSchema }: UseInputsOptions): UseInputsReturn {
  const isGrouped = useMemo(() => isGroupedSchema(inputSchema), [inputSchema]);

  const groups = useMemo(
    () => (isGroupedSchema(inputSchema) ? inputSchema.input_groups : null),
    [inputSchema],
  );

  const flatInputs = useMemo(() => flattenInputs(inputSchema), [inputSchema]);

  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [maxUnlockedGroupIndex, setMaxUnlockedGroupIndex] = useState(0);

  const totalGroups = useMemo(() => groups?.length ?? 0, [groups]);

  const isLastGroup = useMemo(
    () => activeGroupIndex === totalGroups - 1,
    [activeGroupIndex, totalGroups],
  );

  const isFirstGroup = useMemo(
    () => activeGroupIndex === 0,
    [activeGroupIndex],
  );

  const currentGroup = useMemo(() => {
    if (!groups || activeGroupIndex >= groups.length) return null;
    return groups[activeGroupIndex];
  }, [groups, activeGroupIndex]);

  const goToNext = useCallback(() => {
    if (!isGrouped || isLastGroup) return;

    setActiveGroupIndex((prev) => {
      const nextIndex = prev + 1;
      if (nextIndex > maxUnlockedGroupIndex) {
        setMaxUnlockedGroupIndex(nextIndex);
      }
      return nextIndex;
    });
  }, [isGrouped, isLastGroup, maxUnlockedGroupIndex]);

  const goBack = useCallback(() => {
    if (!isGrouped || isFirstGroup) return;
    setActiveGroupIndex((prev) => prev - 1);
  }, [isGrouped, isFirstGroup]);

  const goToGroup = useCallback(
    (index: number) => {
      if (!groups) return;
      if (index >= 0 && index <= maxUnlockedGroupIndex) {
        setActiveGroupIndex(index);
      }
    },
    [groups, maxUnlockedGroupIndex],
  );

  const reset = useCallback(() => {
    setActiveGroupIndex(0);
    setMaxUnlockedGroupIndex(0);
  }, []);

  return {
    isGrouped,
    groups,
    flatInputs,
    totalGroups,
    activeGroupIndex,
    maxUnlockedGroupIndex,
    isFirstGroup,
    isLastGroup,
    currentGroup,
    goToNext,
    goBack,
    goToGroup,
    reset,
  };
}
