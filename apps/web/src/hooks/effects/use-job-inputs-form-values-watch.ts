"use client";

import { useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { JobInputsFormSchemaType } from "@/lib/job-input/form";

/**
 * Watches `react-hook-form` values for `JobInputsFormBuilder` and forwards live
 * draft values to `onValuesChange` with setup-bound subscription semantics.
 */
export function useJobInputsFormValuesWatch(
  form: UseFormReturn<JobInputsFormSchemaType>,
  onValuesChange: ((values: JobInputsFormSchemaType) => void) | undefined,
): void {
  useEffect(() => {
    if (!onValuesChange) return;
    const subscription = form.watch((values) => {
      onValuesChange(values as JobInputsFormSchemaType);
    });
    return () => subscription.unsubscribe();
  }, [form, onValuesChange]);
}
