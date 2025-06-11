"use client";

import { useTranslations } from "next-intl";
import {
  ControllerRenderProps,
  FieldValues,
  Path,
  UseFormReturn,
} from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { FormData } from "@/lib/form";

import RequiredEmailDomainsInput from "./required-email-domains-input";

type OrganizationEditFormNamespace =
  "Components.Organizations.EditInformationModal.Form";

interface FormFieldsProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  formData: FormData<T, OrganizationEditFormNamespace>;
}

export function FormFields<T extends FieldValues>({
  form,
  formData,
}: FormFieldsProps<T>) {
  const t = useTranslations(
    "Components.Organizations.EditInformationModal.Form",
  );

  return (
    <div className="flex flex-col gap-4">
      {formData.map((formDataItem) => (
        <FormField
          key={formDataItem.name.toString()}
          control={form.control}
          name={formDataItem.name as unknown as Path<T>}
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <FormInput field={field} formDataItem={formDataItem} t={t} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
    </div>
  );
}

interface FormInputProps<T extends FieldValues> {
  field: ControllerRenderProps<T, Path<T>>;
  formDataItem: FormData<T, OrganizationEditFormNamespace>[number];
  t: IntlTranslation<OrganizationEditFormNamespace>;
}

function FormInput<T extends FieldValues>({
  field,
  formDataItem,
  t,
}: FormInputProps<T>) {
  const { type, labelKey, name, placeholderKey } = formDataItem;

  if (name === "requiredEmailDomains") {
    return (
      <>
        {labelKey && <p className="text-sm font-medium">{t(labelKey)}</p>}
        <RequiredEmailDomainsInput
          id={name.toString()}
          domains={field.value}
          onChange={field.onChange}
          placeholder={placeholderKey && t(placeholderKey)}
        />
      </>
    );
  }

  return (
    <Input
      id={name.toString()}
      placeholder={placeholderKey && t(placeholderKey)}
      type={type ?? "text"}
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
