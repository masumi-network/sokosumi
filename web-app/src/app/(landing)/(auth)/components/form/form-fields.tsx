"use client";

import { useTranslations } from "next-intl";
import { FieldValues, Path, UseFormReturn } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { FormData } from "@/lib/form";

import { AuthNamespace } from "./types";

interface FormFieldsProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  formData: FormData<T, AuthNamespace>;
  namespace: AuthNamespace;
}

export function FormFields<T extends FieldValues>({
  form,
  formData,
  namespace,
}: FormFieldsProps<T>) {
  const t = useTranslations(namespace);

  return (
    <>
      {formData.map(({ name, labelKey, placeholderKey, type }) => (
        <FormField
          key={name.toString()}
          control={form.control}
          name={name as unknown as Path<T>}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{labelKey && t(labelKey)}</FormLabel>
              <FormControl>
                <Input
                  placeholder={placeholderKey && t(placeholderKey)}
                  type={type ?? "text"}
                  {...field}
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
