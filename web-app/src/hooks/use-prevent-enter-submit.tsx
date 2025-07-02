import React, { useCallback, useRef } from "react";
import { FieldValues, SubmitHandler, UseFormReturn } from "react-hook-form";

export default function usePreventEnterSubmit<T extends FieldValues>(
  form: UseFormReturn<T>,
  handleSubmit: SubmitHandler<T>,
) {
  const enterPressed = useRef(false);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLFormElement>) => {
      const pressedEnter = e.key === "Enter";
      const ctrlOrCmd = e.metaKey || e.ctrlKey;

      if (pressedEnter && !ctrlOrCmd) {
        enterPressed.current = true;
      } else {
        enterPressed.current = false;
      }

      if (pressedEnter && ctrlOrCmd) {
        form.handleSubmit(handleSubmit)(e);
      }
    },
    [form, handleSubmit],
  );

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      if (enterPressed.current) {
        form.handleSubmit(() => {})(e);
      } else {
        form.handleSubmit(handleSubmit)(e);
      }
    },
    [form, handleSubmit],
  );

  return { onKeyDown, onSubmit };
}
