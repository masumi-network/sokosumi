"use client";

import { useTranslations } from "next-intl";
import type {
  ControllerRenderProps,
  FieldValues,
  Path,
  UseFormReturn,
} from "react-hook-form";

import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormData } from "@/lib/form";

import { PasswordInput } from "./password-input";
import type { AuthNamespace } from "./types";

interface FormFieldsProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  formData: FormData<T, AuthNamespace>;
  namespace: AuthNamespace;
}

/**
 * The fields of an auth step. Each step asks one or two things that its
 * header already names, so a field's name sits inside it as the placeholder,
 * centered with the button. The label stays for screen readers and password
 * managers.
 */
export function FormFields<T extends FieldValues>({
  form,
  formData,
  namespace,
}: FormFieldsProps<T>) {
  const t = useTranslations(namespace);
  const authT = useTranslations("Auth");

  return (
    <>
      {formData.map((formDataItem) => (
        <FormField
          key={formDataItem.name.toString()}
          control={form.control}
          name={formDataItem.name as unknown as Path<T>}
          render={({ field }) => (
            <FormItem>
              {formDataItem.labelKey && formDataItem.type !== "checkbox" ? (
                <FormLabel className="sr-only">
                  {t(formDataItem.labelKey)}
                </FormLabel>
              ) : null}
              <FormControl>
                <FormInput
                  field={field}
                  formDataItem={formDataItem}
                  t={t}
                  authT={authT}
                />
              </FormControl>
              {formDataItem.descriptionKey ? (
                <FormDescription className="text-center">
                  {t(formDataItem.descriptionKey)}
                </FormDescription>
              ) : null}
              <FormMessage className="text-center" />
            </FormItem>
          )}
        />
      ))}
    </>
  );
}

// `FormControl` hands its child the field id and the ARIA wiring to the
// error message; the rest props carry them to the input.
interface FormInputProps<T extends FieldValues>
  extends Pick<
    React.ComponentProps<"input">,
    "id" | "aria-describedby" | "aria-invalid"
  > {
  field: ControllerRenderProps<T, Path<T>>;
  formDataItem: FormData<T, AuthNamespace>[number];
  t: IntlTranslation<AuthNamespace>;
  authT: IntlTranslation<"Auth">;
}

function FormInput<T extends FieldValues>({
  field,
  formDataItem,
  t,
  authT,
  ...controlProps
}: FormInputProps<T>) {
  const { autoComplete, type, labelKey, name, placeholderKey, disabled } =
    formDataItem;
  const placeholderSource = placeholderKey ?? labelKey;
  const placeholder = placeholderSource && t(placeholderSource);

  if (type === "checkbox") {
    const id = labelKey?.toString() ?? name.toString();

    return (
      <div className="flex items-center justify-center gap-2">
        <Checkbox
          id={id}
          checked={field.value}
          onCheckedChange={field.onChange}
        />
        <Label htmlFor={id}>{labelKey && t(labelKey)}</Label>
      </div>
    );
  }

  if (type === "password") {
    return (
      <PasswordInput
        {...controlProps}
        data-testid={`auth-field-${name.toString()}`}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="text-center"
        showLabel={authT("PasswordToggle.show")}
        hideLabel={authT("PasswordToggle.hide")}
        {...field}
        value={typeof field.value === "string" ? field.value : ""}
        disabled={disabled}
      />
    );
  }

  return (
    <Input
      {...controlProps}
      data-testid={`auth-field-${name.toString()}`}
      autoComplete={autoComplete}
      placeholder={placeholder}
      className="text-center"
      type={type ?? "text"}
      // Phones would otherwise capitalise and autocorrect the address.
      {...(type === "email" && { autoCapitalize: "none", spellCheck: false })}
      {...field}
      value={field.value}
      disabled={disabled}
    />
  );
}
