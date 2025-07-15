"use client";

import { ReactNode } from "react";
import { FieldValues, UseFormReturn } from "react-hook-form";

import { Form } from "@/components/ui/form";
import { cn } from "@/lib/utils";

interface BaseFormProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  onSubmit: (values: T) => Promise<void>;
  submitEventName?: string;
  children: ReactNode;
  className?: string;
}

export function BaseForm<T extends FieldValues>({
  form,
  onSubmit,
  submitEventName,
  children,
  className,
}: BaseFormProps<T>) {
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn(
          submitEventName && `plausible-event-name=${submitEventName}`,
          className,
        )}
      >
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
