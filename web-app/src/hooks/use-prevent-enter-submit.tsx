import React, { useCallback, useEffect, useRef } from "react";
import { FieldValues, SubmitHandler, UseFormReturn } from "react-hook-form";

export default function usePreventEnterSubmit<T extends FieldValues>(
  form: UseFormReturn<T>,
  handleSubmit: SubmitHandler<T>,
  isActive: boolean,
) {
  const preventEnterSubmit = useRef(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const pressedEnter = e.key === "Enter";
      const ctrlOrCmd = e.metaKey || e.ctrlKey;
      const isTextArea = e.target instanceof HTMLTextAreaElement;
      const isInput = e.target instanceof HTMLInputElement;
      const isContentEditable =
        e.target instanceof HTMLElement && e.target.isContentEditable;

      // Only prevent Enter submission for non-textarea, non-contenteditable elements
      // and when not using Ctrl/Cmd+Enter (which should always submit)
      if (pressedEnter && !isTextArea && !isContentEditable && !ctrlOrCmd) {
        // For input elements, only prevent if it's not a submit button
        if (
          isInput &&
          e.target instanceof HTMLInputElement &&
          e.target.type === "submit"
        ) {
          return; // Allow Enter on submit buttons
        }

        // Set the flag to prevent form submission
        preventEnterSubmit.current = true;

        // Reset the flag after a short delay to handle race conditions
        setTimeout(() => {
          preventEnterSubmit.current = false;
        }, 100);
      }

      // Handle Ctrl/Cmd+Enter submission
      if (pressedEnter && ctrlOrCmd) {
        if (formRef.current) {
          formRef.current.requestSubmit();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isActive]);

  const enterPreventedHandleSubmit = useCallback(
    (e: React.FormEvent) => {
      if (preventEnterSubmit.current) {
        // only don't run handleSubmit
        form.handleSubmit(() => {})(e);
        // Reset the flag immediately
        preventEnterSubmit.current = false;
        return;
      }

      // Normal form submission
      form.handleSubmit(handleSubmit)(e);
    },
    [form, handleSubmit],
  );

  return { formRef, handleSubmit: enterPreventedHandleSubmit };
}
