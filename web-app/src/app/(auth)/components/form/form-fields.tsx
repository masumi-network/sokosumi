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
import { OrganizationWithMembersCount } from "@/lib/db";
import { FormData } from "@/lib/form";
import { Organization } from "@/prisma/generated/client";

import { OrganizationInput } from "./organization-input";
import { AuthNamespace } from "./types";

interface FormFieldsProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  formData: FormData<T, AuthNamespace>;
  namespace: AuthNamespace;
  organizations?: OrganizationWithMembersCount[] | undefined;
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
  field: ControllerRenderProps<T, Path<T>>;
  formDataItem: FormData<T, AuthNamespace>[number];
  t: IntlTranslation<AuthNamespace>;
  organizations?: OrganizationWithMembersCount[] | undefined;
}

function FormInput<T extends FieldValues>({
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
    const organizationId = field.value;
    const organization = organizations.find(
      (organization) => organization.id === organizationId,
    );
    const handleOrganizationChange = (organization: Organization) => {
      field.onChange(organization.id);
    };

    return (
      <OrganizationInput
        organizations={organizations}
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
