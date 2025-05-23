"use client";

import { ReactNode } from "react";
import { FieldValues, UseFormReturn } from "react-hook-form";

import { OrganizationWithRelations } from "@/lib/db";
import { FormData } from "@/lib/form";

import { BaseForm } from "./base-form";
import { FormFields } from "./form-fields";
import { AuthNamespace } from "./types";

interface AuthFormProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  formData: FormData<T, AuthNamespace>;
  namespace: AuthNamespace;
  onSubmit: (values: T) => Promise<void>;
  organizations?: OrganizationWithRelations[] | undefined;
  children: ReactNode;
}

export function AuthForm<T extends FieldValues>({
  form,
  formData,
  namespace,
  onSubmit,
  organizations,
  children,
}: AuthFormProps<T>) {
  return (
    <BaseForm form={form} onSubmit={onSubmit}>
      <FormFields
        form={form}
        formData={formData}
        namespace={namespace}
        organizations={organizations}
      />
      {children}
    </BaseForm>
  );
}
