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

type AuthNamespace =
  | "Auth.Email.Form"
  | "Auth.Pages.ForgotPassword.Form"
  | "Auth.Pages.SignUp.Form"
  | "Auth.Pages.ResetPassword.Form";

interface FormFieldsProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  formData: FormData<T, AuthNamespace>;
  namespace: AuthNamespace;
  /** Labels above the fields, for a step that asks more than its header names. */
  visibleLabels?: boolean;
}

/**
 * The fields of an auth step. Each step asks one or two things that its
 * header already names, so a field's name sits inside it as the placeholder,
 * centered with the button. The label stays for screen readers and password
 * managers. A step that asks more (sign-up's names, password and code) shows
 * the labels instead, since a placeholder goes at the first keystroke.
 */
export function FormFields<T extends FieldValues>({
  form,
  formData,
  namespace,
  visibleLabels = false,
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
              {formDataItem.labelKey && formDataItem.type !== "checkbox" ? (
                <FormLabel
                  className={visibleLabels ? "justify-center" : "sr-only"}
                >
                  {t(formDataItem.labelKey)}
                </FormLabel>
              ) : null}
              <FormControl>
                <FormInput
                  field={field}
                  formDataItem={formDataItem}
                  t={t}
                  placeholder={!visibleLabels}
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
  /** Repeat the label inside the field; off when it shows above. */
  placeholder: boolean;
}

function FormInput<T extends FieldValues>({
  field,
  formDataItem,
  t,
  placeholder: withPlaceholder,
  ...controlProps
}: FormInputProps<T>) {
  const { autoComplete, type, labelKey, name, disabled } = formDataItem;
  // The auth fields' placeholders repeat their labels.
  const placeholder = withPlaceholder && labelKey ? t(labelKey) : undefined;

  if (type === "checkbox") {
    const id = labelKey?.toString() ?? name.toString();

    return (
      <div className="flex items-center gap-2">
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
