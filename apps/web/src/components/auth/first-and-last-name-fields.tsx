"use client";

import { useTranslations } from "next-intl";
import type { Control, Path } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { FirstAndLastNameFormType } from "@/lib/schemas/account";

interface FirstAndLastNameFieldsProps<T extends FirstAndLastNameFormType> {
  control: Control<T>;
  testIdPrefix: string;
  disabled?: boolean;
}

export function FirstAndLastNameFields<T extends FirstAndLastNameFormType>({
  control,
  testIdPrefix,
  disabled,
}: FirstAndLastNameFieldsProps<T>) {
  const t = useTranslations("Library.Auth.NameField");

  return (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <FormField
        control={control}
        name={"firstName" as Path<T>}
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
        name={"lastName" as Path<T>}
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
