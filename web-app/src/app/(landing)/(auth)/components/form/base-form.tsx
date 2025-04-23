"use client";

import { ReactNode } from "react";
import { FieldValues, UseFormReturn } from "react-hook-form";

import { Form } from "@/components/ui/form";

interface BaseFormProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  onSubmit: (values: T) => Promise<void>;
  children: ReactNode;
}

export function BaseForm<T extends FieldValues>({
  form,
  onSubmit,
  children,
}: BaseFormProps<T>) {
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <fieldset
          disabled={form.formState.isSubmitting}
          className="flex flex-col gap-3"
        >
          {children}
        </fieldset>
      </form>
    </Form>
  );
}
