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
  prefilledOrganization?: OrganizationWithRelations | null;
  namespace: AuthNamespace;
  onSubmit: (values: T) => Promise<void>;
  organizations?: OrganizationWithRelations[] | undefined;
  children: ReactNode;
  className?: string;
}

export function AuthForm<T extends FieldValues>({
  form,
  formData,
  prefilledOrganization,
  namespace,
  onSubmit,
  children,

  className,
}: AuthFormProps<T>) {
  return (
    <BaseForm form={form} onSubmit={onSubmit} className={className}>
      <FormFields
        form={form}
        formData={formData}
        prefilledOrganization={prefilledOrganization}
        namespace={namespace}
      />
      {children}
    </BaseForm>
  );
}
