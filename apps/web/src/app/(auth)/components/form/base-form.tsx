"use client";

import { ReactNode } from "react";
import { FieldValues, UseFormReturn } from "react-hook-form";

import { Form } from "@/components/ui/form";
import { cn } from "@/lib/utils";

interface BaseFormProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  onSubmit: (values: T) => Promise<void>;
  children: ReactNode;
  className?: string;
}

export function BaseForm<T extends FieldValues>({
  form,
  onSubmit,
  children,
  className,
}: BaseFormProps<T>) {
  const { isSubmitting } = form.formState;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className={cn(className)}>
        <fieldset disabled={isSubmitting} className="flex flex-col gap-3">
          {children}
        </fieldset>
      </form>
    </Form>
  );
}
