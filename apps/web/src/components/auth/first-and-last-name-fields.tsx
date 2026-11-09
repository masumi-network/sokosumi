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
import { cn } from "@/lib/utils";

interface FirstAndLastNameFieldsProps<T extends FirstAndLastNameFormType> {
  control: Control<T>;
  testIdPrefix: string;
  disabled?: boolean;
  /**
   * On the auth pages the labels and names sit centered, like the email
   * code field below them. The labels stay visible: a placeholder vanishes
   * on the first keystroke.
   */
  centered?: boolean;
}

const NAME_FIELDS = [
  {
    name: "firstName",
    labelKey: "firstNameLabel",
    autoComplete: "given-name",
    testId: "first-name",
  },
  {
    name: "lastName",
    labelKey: "lastNameLabel",
    autoComplete: "family-name",
    testId: "last-name",
  },
] as const;

export function FirstAndLastNameFields<T extends FirstAndLastNameFormType>({
  control,
  testIdPrefix,
  disabled,
  centered = false,
}: FirstAndLastNameFieldsProps<T>) {
  const t = useTranslations("Library.Auth.NameField");

  return (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      {NAME_FIELDS.map(({ name, labelKey, autoComplete, testId }) => (
        <FormField
          key={name}
          control={control}
          name={name as Path<T>}
          render={({ field }) => (
            <FormItem>
              <FormLabel className={cn(centered && "justify-center")}>
                {t(labelKey)}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete={autoComplete}
                  className={cn(centered && "text-center")}
                  disabled={disabled}
                  data-testid={`${testIdPrefix}-${testId}`}
                />
              </FormControl>
              <FormMessage className={cn(centered && "text-center")} />
            </FormItem>
          )}
        />
      ))}
    </div>
  );
}
