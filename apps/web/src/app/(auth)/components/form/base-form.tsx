"use client";

import type { FormEventHandler, ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import { Form } from "@/components/ui/form";
import { cn } from "@/lib/utils";

interface BaseFormProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  onSubmit: (values: T) => Promise<void>;
  children: ReactNode;
  className?: string;
  onChange?: FormEventHandler<HTMLFormElement>;
}

export function BaseForm<T extends FieldValues>({
  form,
  onSubmit,
  children,
  className,
  onChange,
}: BaseFormProps<T>) {
  const { isSubmitting } = form.formState;

  return (
    <Form {...form}>
      {/* The schema validates; the browser's own email check would show an
          untranslated tooltip instead of the form's message. */}
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        onChange={onChange}
        className={cn(className)}
      >
        <fieldset disabled={isSubmitting} className="flex flex-col gap-3">
          {children}
        </fieldset>
      </form>
    </Form>
  );
}
