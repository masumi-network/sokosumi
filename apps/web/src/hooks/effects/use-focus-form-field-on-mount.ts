"use client";

import { useEffect, useEffectEvent } from "react";
import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";

/**
 * Focuses a `react-hook-form` field once when the form mounts (or reveals from
 * React Activity) without re-focusing on later re-renders.
 */
export function useFocusFormFieldOnMount<TFieldValues extends FieldValues>(
  form: Pick<UseFormReturn<TFieldValues>, "setFocus">,
  fieldName: FieldPath<TFieldValues>,
): void {
  const focusField = useEffectEvent(() => {
    form.setFocus(fieldName);
  });

  useEffect(() => {
    focusField();
  }, []);
}
