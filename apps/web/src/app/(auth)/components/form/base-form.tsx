"use client";

import { type FormEventHandler, type ReactNode, type Ref, useRef } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import { Form } from "@/components/ui/form";
import { cn } from "@/lib/utils";

interface BaseFormProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  onSubmit: (values: T) => Promise<void>;
  children: ReactNode;
  className?: string;
  onChange?: FormEventHandler<HTMLFormElement>;
  formRef?: Ref<HTMLFormElement>;
  disabled?: boolean;
}

export function BaseForm<T extends FieldValues>({
  form,
  onSubmit,
  children,
  className,
  onChange,
  formRef,
  disabled = false,
}: BaseFormProps<T>) {
  const { isSubmitting } = form.formState;
  const submitting = useRef(false);

  return (
    <Form {...form}>
      {/* The schema validates; the browser's own email check would show an
          untranslated tooltip instead of the form's message. */}
      <form
        noValidate
        ref={formRef}
        onSubmit={async (event) => {
          event.preventDefault();
          // Lock before the async resolver; automatic and manual submits
          // can arrive before React renders isSubmitting.
          if (submitting.current || disabled) return;
          submitting.current = true;
          try {
            await form.handleSubmit(onSubmit)(event);
          } finally {
            submitting.current = false;
          }
        }}
        onChange={onChange}
        className={cn(className)}
      >
        <fieldset
          disabled={isSubmitting || disabled}
          className="flex flex-col gap-3"
        >
          {children}
        </fieldset>
      </form>
    </Form>
  );
}
