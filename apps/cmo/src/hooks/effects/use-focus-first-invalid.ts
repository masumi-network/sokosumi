"use client";

import { type RefObject, useEffect, useRef } from "react";

/**
 * For a `useActionState` form that remounts with `key={attempt}`, because a
 * form resets after its action: remounting shows the kept values and reads
 * out a repeated alert again. After a failed submit, focus moves to the
 * first field to fix, which reads out its error, or else to the form's
 * alert; the remount would otherwise drop focus to the page.
 */
export function useFocusFirstInvalid(
  attempt: number,
): RefObject<HTMLFormElement | null> {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (attempt === 0) return;
    const form = formRef.current;
    (
      form?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      form?.querySelector<HTMLElement>('[role="alert"]')
    )?.focus();
  }, [attempt]);
  return formRef;
}
