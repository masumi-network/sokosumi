"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  ControllerRenderProps,
  FieldValues,
  Path,
  UseFormReturn,
} from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";

import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAllowedOrganizationsByEmailPartial } from "@/lib/actions/organization/action";
import { OrganizationWithRelations } from "@/lib/db/types/organization";
import { FormData } from "@/lib/form";
import { isValidEmail } from "@/lib/utils";

import { OrganizationInput } from "./organization-input";
import { AuthNamespace } from "./types";

interface FormFieldsProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  formData: FormData<T, AuthNamespace>;
  prefilledEmail?: string | undefined;
  prefilledOrganization?: OrganizationWithRelations | null;
  namespace: AuthNamespace;
}

export function FormFields<T extends FieldValues>({
  form,
  formData,
  prefilledEmail,
  prefilledOrganization,
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
                <FormInput
                  form={form}
                  field={field}
                  formDataItem={formDataItem}
                  t={t}
                  prefilledEmail={prefilledEmail}
                  prefilledOrganization={prefilledOrganization}
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
  prefilledEmail?: string | undefined;
  prefilledOrganization?: OrganizationWithRelations | null;
}

export function FormInput<T extends FieldValues>({
  form,
  field,
  formDataItem,
  t,
  prefilledEmail,
  prefilledOrganization,
}: FormInputProps<T>) {
  const { type, labelKey, name, placeholderKey } = formDataItem;
  const emailPrefilled = name === "email" && !!prefilledEmail;
  const organizationIdPrefilled =
    name === "selectedOrganization" && !!prefilledOrganization;
  const [allowedOrganizations, setAllowedOrganizations] = useState<
    OrganizationWithRelations[]
  >(prefilledOrganization ? [prefilledOrganization] : []);
  const [isLoading, setIsLoading] = useState(false);
  const email = form.watch("email" as unknown as Path<T>);
  const [selectedOrganization, setSelectedOrganization] = useState<
    OrganizationWithRelations | { name: string } | undefined
  >(
    prefilledOrganization ??
      allowedOrganizations.find((org) => org.id === field.value?.id),
  );
  useEffect(() => {
    if (name != "selectedOrganization") return;
    if (prefilledOrganization) {
      setSelectedOrganization(prefilledOrganization);
      return;
    }
    setSelectedOrganization(undefined);
  }, [prefilledOrganization, email, name]);

  const debouncedGetAllowedOrganizations = useDebouncedCallback(
    async (email: string, organizationId: string | null) => {
      const result = await getAllowedOrganizationsByEmailPartial(
        email,
        organizationId,
      );
      setAllowedOrganizations(result);
      if (email === form.getValues("email" as unknown as Path<T>)) {
        setIsLoading(false);
      }
    },
    350,
    { trailing: true, leading: true },
  );

  useEffect(() => {
    if (name != "selectedOrganization") return;
    try {
      setIsLoading(true);
      debouncedGetAllowedOrganizations.cancel();
      if (!isValidEmail(email)) {
        setIsLoading(false);
        setAllowedOrganizations([]);
        return;
      }
      const debouncedResult = debouncedGetAllowedOrganizations(
        email,
        prefilledOrganization?.id ?? null,
      );
      if (!debouncedResult) {
        setIsLoading(false);
        setAllowedOrganizations([]);
        return;
      }
    } catch (error) {
      console.error(error);
      setIsLoading(false);
      setAllowedOrganizations([]);
    }
  }, [email, debouncedGetAllowedOrganizations, prefilledOrganization, name]);

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

  if (name === "selectedOrganization") {
    const handleOrganizationChange = (
      organization: OrganizationWithRelations | { name: string },
    ) => {
      setSelectedOrganization(organization);
      // Set the full organization object with id and name properties
      field.onChange({
        id: "id" in organization ? organization.id : null,
        name: organization?.name,
      });
    };

    return (
      <OrganizationInput
        email={email}
        isLoading={isLoading}
        organizations={allowedOrganizations}
        value={selectedOrganization}
        onChange={handleOrganizationChange}
        disabled={organizationIdPrefilled}
      />
    );
  }

  return (
    <Input
      placeholder={placeholderKey && t(placeholderKey)}
      type={type ?? "text"}
      {...field}
      disabled={emailPrefilled}
      value={emailPrefilled ? prefilledEmail : field.value}
    />
  );
}
