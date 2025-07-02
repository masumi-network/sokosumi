import React, { useCallback, useRef } from "react";
import { FieldValues, SubmitHandler, UseFormReturn } from "react-hook-form";

export default function usePreventEnterSubmit<T extends FieldValues>(
  form: UseFormReturn<T>,
  handleSubmit: SubmitHandler<T>,
) {
  const preventEnterSubmit = useRef(false);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLFormElement>) => {
      const pressedEnter = e.key === "Enter";
      const ctrlOrCmd = e.metaKey || e.ctrlKey;
      const isTextArea = e.target instanceof HTMLTextAreaElement;

      preventEnterSubmit.current = pressedEnter && !isTextArea;

      // submit form directly with ctrl/cmd + enter
      if (pressedEnter && ctrlOrCmd) {
        form.handleSubmit(handleSubmit)(e);
      }
    },
    [form, handleSubmit],
  );

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

  return { onKeyDown, onSubmit };
}
