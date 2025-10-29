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

type OrganizationInviteFormNamespace =
  "Components.Organizations.InviteMemberModal.Form";

interface FormFieldsProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  formData: FormData<T, OrganizationInviteFormNamespace>;
}

export function FormFields<T extends FieldValues>({
  form,
  formData,
}: FormFieldsProps<T>) {
  const t = useTranslations("Components.Organizations.InviteMemberModal.Form");

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
  formDataItem: FormData<T, OrganizationInviteFormNamespace>[number];
  t: IntlTranslation<OrganizationInviteFormNamespace>;
}

function FormInput<T extends FieldValues>({
  field,
  formDataItem,
  t,
}: FormInputProps<T>) {
  const { type, name, placeholderKey } = formDataItem;

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
