"use client";

import type {
  InputGroupSchemaType,
  InputSchemaSchemaType,
} from "@sokosumi/masumi/schemas";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { UseFormReturn } from "react-hook-form";

import {
  flattenInputs,
  getGroupFieldIds,
  isGroupedSchema,
} from "@/lib/helpers/input-schema";
import type { JobInputsFormSchemaType } from "@/lib/job-input";

interface UseGroupedInputWizardOptions {
  inputSchema: InputSchemaSchemaType;
  form: UseFormReturn<JobInputsFormSchemaType>;
}

interface UseGroupedInputWizardReturn {
  isGrouped: boolean;
  groups: InputGroupSchemaType[] | null;
  totalGroups: number;
  activeGroupIndex: number;
  maxUnlockedGroupIndex: number;
  isFirstGroup: boolean;
  isLastGroup: boolean;
  currentGroupFieldIds: string[];
  isValidating: boolean;
  isCurrentGroupValid: boolean;
  flatInputs: ReturnType<typeof flattenInputs>;
  handleNext: () => Promise<boolean>;
  handleBack: () => void;
  handleTabChange: (value: string) => void;
  resetWizard: () => void;
}

export function useGroupedInputWizard({
  inputSchema,
  form,
}: UseGroupedInputWizardOptions): UseGroupedInputWizardReturn {
  const isGrouped = useMemo(() => isGroupedSchema(inputSchema), [inputSchema]);

  const groups = useMemo(
    () => (isGroupedSchema(inputSchema) ? inputSchema.input_groups : null),
    [inputSchema],
  );

  const flatInputs = useMemo(() => flattenInputs(inputSchema), [inputSchema]);

  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [maxUnlockedGroupIndex, setMaxUnlockedGroupIndex] = useState(0);
  const [isValidating, setIsValidating] = useState(false);

  const totalGroups = useMemo(() => groups?.length ?? 0, [groups]);

  const isLastGroup = useMemo(
    () => activeGroupIndex === totalGroups - 1,
    [activeGroupIndex, totalGroups],
  );

  const isFirstGroup = useMemo(
    () => activeGroupIndex === 0,
    [activeGroupIndex],
  );

  const currentGroupFieldIds = useMemo(() => {
    if (!isGrouped) return [];
    return getGroupFieldIds(inputSchema, activeGroupIndex);
  }, [inputSchema, activeGroupIndex, isGrouped]);

  const { errors, dirtyFields, isValid: formIsValid } = form.formState;

  const [initialFieldValidity, setInitialFieldValidity] = useState<{
    hasValidated: boolean;
    invalidFields: Set<string>;
  }>({ hasValidated: false, invalidFields: new Set() });

  const watchedValues = form.watch(
    currentGroupFieldIds as (keyof JobInputsFormSchemaType)[],
  );

  useEffect(() => {
    if (!isGrouped) {
      setInitialFieldValidity({
        hasValidated: true,
        invalidFields: new Set(),
      });
      return;
    }

    setInitialFieldValidity({ hasValidated: false, invalidFields: new Set() });

    let cancelled = false;

    const validateSilently = async () => {
      if (currentGroupFieldIds.length === 0) {
        if (!cancelled) {
          setInitialFieldValidity({
            hasValidated: true,
            invalidFields: new Set(),
          });
        }
        return;
      }

      await form.trigger(
        currentGroupFieldIds as (keyof JobInputsFormSchemaType)[],
      );

      if (cancelled) return;

      const currentErrors = form.formState.errors;

      const invalidFields = new Set(
        currentGroupFieldIds.filter((fieldId) => fieldId in currentErrors),
      );

      form.clearErrors(
        currentGroupFieldIds as (keyof JobInputsFormSchemaType)[],
      );

      if (!cancelled) {
        setInitialFieldValidity({ hasValidated: true, invalidFields });
      }
    };

    validateSilently();

    return () => {
      cancelled = true;
    };
  }, [isGrouped, activeGroupIndex, currentGroupFieldIds, form]);

  const isCurrentGroupValid = useMemo(() => {
    if (!initialFieldValidity.hasValidated) return false;

    if (!isGrouped) return formIsValid;

    for (const fieldId of currentGroupFieldIds) {
      const isDirty = fieldId in dirtyFields;
      const hasError = fieldId in errors;
      const wasInitiallyInvalid =
        initialFieldValidity.invalidFields.has(fieldId);

      if (isDirty) {
        if (hasError) return false;
      } else {
        if (wasInitiallyInvalid) return false;
      }
    }

    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialFieldValidity,
    isGrouped,
    formIsValid,
    errors,
    dirtyFields,
    currentGroupFieldIds,
    watchedValues,
  ]);

  const handleNext = useCallback(async (): Promise<boolean> => {
    if (!isGrouped || isLastGroup || isValidating) return false;

    setIsValidating(true);

    try {
      const formValues = form.getValues();

      const validFieldIds = currentGroupFieldIds.filter(
        (id) => id in formValues,
      );

      const isValid = await form.trigger(
        validFieldIds as (keyof JobInputsFormSchemaType)[],
      );

      if (isValid) {
        const nextIndex = activeGroupIndex + 1;
        setActiveGroupIndex(nextIndex);
        if (nextIndex > maxUnlockedGroupIndex) {
          setMaxUnlockedGroupIndex(nextIndex);
        }
        return true;
      }

      return false;
    } finally {
      setIsValidating(false);
    }
  }, [
    isGrouped,
    isLastGroup,
    isValidating,
    form,
    currentGroupFieldIds,
    activeGroupIndex,
    maxUnlockedGroupIndex,
  ]);

  const handleBack = useCallback(() => {
    if (!isGrouped || isFirstGroup || isValidating) return;
    setActiveGroupIndex((prev) => prev - 1);
  }, [isGrouped, isFirstGroup, isValidating]);

  const handleTabChange = useCallback(
    (value: string) => {
      if (!groups || isValidating) return;

      const newIndex = groups.findIndex((g) => g.id === value);
      if (newIndex >= 0 && newIndex <= maxUnlockedGroupIndex) {
        setActiveGroupIndex(newIndex);
      }
    },
    [groups, maxUnlockedGroupIndex, isValidating],
  );

  const resetWizard = useCallback(() => {
    setActiveGroupIndex(0);
    setMaxUnlockedGroupIndex(0);
    setIsValidating(false);
  }, []);

  return {
    isGrouped,
    groups,
    totalGroups,
    activeGroupIndex,
    maxUnlockedGroupIndex,
    isFirstGroup,
    isLastGroup,
    currentGroupFieldIds,
    isValidating,
    isCurrentGroupValid,
    flatInputs,
    handleNext,
    handleBack,
    handleTabChange,
    resetWizard,
  };
}
