import React, { useCallback, useEffect, useRef } from "react";
import { FieldValues, SubmitHandler, UseFormReturn } from "react-hook-form";

export default function usePreventEnterSubmit<T extends FieldValues>(
  form: UseFormReturn<T>,
  handleSubmit: SubmitHandler<T>,
) {
  const preventEnterSubmit = useRef(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
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
      console.log("Unmount");
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

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
