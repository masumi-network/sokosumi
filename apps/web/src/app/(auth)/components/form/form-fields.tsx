"use client";

import Link from "next/link";
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
    </>
  );
}

interface FormInputProps<T extends FieldValues> {
  field: ControllerRenderProps<T, Path<T>>;
  formDataItem: FormData<T, AuthNamespace>[number];
  t: IntlTranslation<AuthNamespace>;
}

function FormInput<T extends FieldValues>({
  field,
  formDataItem,
  t,
}: FormInputProps<T>) {
  const { type, labelKey, name, placeholderKey, disabled } = formDataItem;

  if (type === "checkbox") {
    const iAgreeToText = t.has("Fields.TermsAccepted.Label.iAgreeTo")
      ? t("Fields.TermsAccepted.Label.iAgreeTo")
      : null;
    const termsOfServiceText = t.has(
      "Fields.TermsAccepted.Label.termsOfService",
    )
      ? t("Fields.TermsAccepted.Label.termsOfService")
      : null;
    const andText = t.has("Fields.TermsAccepted.Label.and")
      ? t("Fields.TermsAccepted.Label.and")
      : null;
    const privacyPolicyText = t.has("Fields.TermsAccepted.Label.privacyPolicy")
      ? t("Fields.TermsAccepted.Label.privacyPolicy")
      : null;

    const allTranslationsExist =
      iAgreeToText && termsOfServiceText && andText && privacyPolicyText;

    const TermsAcceptedLabel = allTranslationsExist ? (
      <Label
        htmlFor={labelKey?.toString() ?? name.toString()}
        className="flex flex-wrap items-center gap-1"
      >
        <span>{iAgreeToText}</span>
        <Link target="_blank" href="/terms-of-service" className="underline">
          {termsOfServiceText}
        </Link>
        <span>{andText}</span>
        <Link target="_blank" href="/privacy-policy" className="underline">
          {privacyPolicyText}
        </Link>
      </Label>
    ) : null;

    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={labelKey?.toString() ?? name.toString()}
          checked={field.value}
          onCheckedChange={field.onChange}
        />
        {name === "termsAccepted" ? (
          TermsAcceptedLabel
        ) : (
          <Label htmlFor={labelKey?.toString() ?? name.toString()}>
            {labelKey && t(labelKey)}
          </Label>
        )}
      </div>
    );
  }

  return (
    <Input
      placeholder={placeholderKey && t(placeholderKey)}
      type={type ?? "text"}
      {...field}
      value={field.value}
      disabled={disabled}
    />
  );
}
