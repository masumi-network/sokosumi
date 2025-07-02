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

      preventEnterSubmit.current = pressedEnter && !isTextArea && !ctrlOrCmd;

      if (pressedEnter && ctrlOrCmd) {
        if (formRef && formRef.current) {
          formRef.current.requestSubmit();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isActive]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      if (preventEnterSubmit.current) {
        form.handleSubmit(() => {})(e);
        preventEnterSubmit.current = false;
      } else {
        form.handleSubmit(handleSubmit)(e);
      }
    },
    [form, handleSubmit],
  );

  return { formRef, onSubmit };
}
