"use client";

import { useTranslations } from "next-intl";
import { FieldValues, Path, UseFormReturn } from "react-hook-form";

import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      {formData.map(({ name, placeholderKey, labelKey, type }) => (
        <FormField
          key={name.toString()}
          control={form.control}
          name={name as unknown as Path<T>}
          render={({ field }) => (
            <FormItem>
              <FormControl>
                {type === "checkbox" ? (
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
                ) : (
                  <Input
                    placeholder={placeholderKey && t(placeholderKey)}
                    type={type ?? "text"}
                    {...field}
                  />
                )}
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
    </>
  );
}
