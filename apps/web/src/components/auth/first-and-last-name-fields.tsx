"use client";

import { useTranslations } from "next-intl";
import type { Control } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { FirstAndLastNameFormType } from "@/lib/schemas/account";

interface FirstAndLastNameFieldsProps {
  control: Control<FirstAndLastNameFormType>;
  testIdPrefix: string;
  disabled?: boolean;
}

export function FirstAndLastNameFields({
  control,
  testIdPrefix,
  disabled,
}: FirstAndLastNameFieldsProps) {
  const t = useTranslations("Library.Auth.NameField");

  return (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <FormField
        control={control}
        name="firstName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("firstNameLabel")}</FormLabel>
            <FormControl>
              <Input
                {...field}
                autoComplete="given-name"
                disabled={disabled}
                data-testid={`${testIdPrefix}-first-name`}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="lastName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("lastNameLabel")}</FormLabel>
            <FormControl>
              <Input
                {...field}
                autoComplete="family-name"
                disabled={disabled}
                data-testid={`${testIdPrefix}-last-name`}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
