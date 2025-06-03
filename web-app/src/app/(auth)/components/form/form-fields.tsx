"use client";

import { useTranslations } from "next-intl";
import {
  ControllerRenderProps,
  FieldValues,
  Path,
  UseFormReturn,
} from "react-hook-form";

import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  filterAllowedOrganizations,
  OrganizationWithRelations,
} from "@/lib/db";
import { FormData } from "@/lib/form";
import { Organization } from "@/prisma/generated/client";

import { OrganizationInput } from "./organization-input";
import { AuthNamespace } from "./types";

interface FormFieldsProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  formData: FormData<T, AuthNamespace>;
  namespace: AuthNamespace;
  organizations?: OrganizationWithRelations[] | undefined;
}

export function FormFields<T extends FieldValues>({
  form,
  formData,
  namespace,
  organizations,
}: FormFieldsProps<T>) {
  const t = useTranslations(namespace);

  return (
    <>
      {formData.map((formDataItem) => (
        <FormField
          key={formDataItem.name.toString()}
          control={form.control}
          name={formDataItem.name as unknown as Path<T>}
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <FormInput
                  form={form}
                  field={field}
                  formDataItem={formDataItem}
                  t={t}
                  organizations={organizations}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
    </>
  );
}

interface FormInputProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  field: ControllerRenderProps<T, Path<T>>;
  formDataItem: FormData<T, AuthNamespace>[number];
  t: IntlTranslation<AuthNamespace>;
  organizations?: OrganizationWithRelations[] | undefined;
}

function FormInput<T extends FieldValues>({
  form,
  field,
  formDataItem,
  t,
  organizations,
}: FormInputProps<T>) {
  const { type, labelKey, name, placeholderKey } = formDataItem;

  if (type === "checkbox") {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={labelKey?.toString() ?? name.toString()}
          checked={field.value}
          onCheckedChange={field.onChange}
        />
        <Label htmlFor={labelKey?.toString() ?? name.toString()}>
          {labelKey && t(labelKey)}
        </Label>
      </div>
    );
  }

  if (name === "organizationId" && !!organizations) {
    const email = form.watch("email" as unknown as Path<T>);
    const allowedOrganizations = filterAllowedOrganizations(
      email,
      organizations,
    );

    const organization = allowedOrganizations.find(
      (organization) => organization.id === field.value,
    );
    const handleOrganizationChange = (organization: Organization) => {
      field.onChange(organization.id);
    };

    return (
      <OrganizationInput
        email={email}
        organizations={allowedOrganizations}
        value={organization}
        onChange={handleOrganizationChange}
      />
    );
  }

  return (
    <Input
      placeholder={placeholderKey && t(placeholderKey)}
      type={type ?? "text"}
      {...field}
    />
  );
}
