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
  resetMaxUnlockedTo: (index: number) => void;
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
    if (!isGrouped || !groups || groups.length === 0) return;

    setActiveGroupIndex((prev) => {
      // Guard: prevent going beyond last group
      if (prev >= groups.length - 1) return prev;

      const nextIndex = prev + 1;
      // Update max unlocked index if needed (using functional update to avoid stale closure)
      setMaxUnlockedGroupIndex((maxUnlocked) =>
        nextIndex > maxUnlocked ? nextIndex : maxUnlocked,
      );
      return nextIndex;
    });
  }, [isGrouped, groups]);

  const goBack = useCallback(() => {
    if (!isGrouped || !groups) return;

    setActiveGroupIndex((prev) => {
      // Guard: prevent going below first group
      if (prev <= 0) return prev;
      return prev - 1;
    });
  }, [isGrouped, groups]);

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

  const resetMaxUnlockedTo = useCallback((index: number) => {
    if (index >= 0) {
      setMaxUnlockedGroupIndex(index);
    }
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
    resetMaxUnlockedTo,
  };
}
