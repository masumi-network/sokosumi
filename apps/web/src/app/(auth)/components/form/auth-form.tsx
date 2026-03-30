"use client";

import type { ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import type { FormData } from "@/lib/form";

import { BaseForm } from "./base-form";
import { FormFields } from "./form-fields";
import type { AuthNamespace } from "./types";

interface AuthFormProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  formData: FormData<T, AuthNamespace>;
  namespace: AuthNamespace;
  onSubmit: (values: T) => Promise<void>;
  children: ReactNode;
  className?: string;
}

export function AuthForm<T extends FieldValues>({
  form,
  formData,
  namespace,
  onSubmit,
  children,
  className,
}: AuthFormProps<T>) {
  return (
    <BaseForm form={form} onSubmit={onSubmit} className={className}>
      <FormFields form={form} formData={formData} namespace={namespace} />
      {children}
    </BaseForm>
  );
}
