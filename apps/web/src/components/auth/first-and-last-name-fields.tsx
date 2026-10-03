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
  /**
   * Underlined on the auth pages (ADR 0051): side by side, named by their
   * placeholders, with the reason for a refusal in the page's error line
   * (`describedBy`) instead of under each field. Boxed and labelled elsewhere.
   */
  variant?: "boxed" | "underlined";
  /** The page's error line, for an underlined field that was refused. */
  describedBy?: string | undefined;
}

export function FirstAndLastNameFields<T extends FirstAndLastNameFormType>({
  control,
  testIdPrefix,
  disabled,
  variant = "boxed",
  describedBy,
}: FirstAndLastNameFieldsProps<T>) {
  const t = useTranslations("Library.Auth.NameField");
  const underlined = variant === "underlined";
  const fields = [
    {
      name: "firstName",
      label: t("firstNameLabel"),
      autoComplete: "given-name",
      testId: "first-name",
    },
    {
      name: "lastName",
      label: t("lastNameLabel"),
      autoComplete: "family-name",
      testId: "last-name",
    },
  ] as const;

  return (
    <div
      className={
        underlined
          ? "grid grid-cols-2 gap-4"
          : "grid items-start gap-4 sm:grid-cols-2"
      }
    >
      {fields.map(({ name, label, autoComplete, testId }) => (
        <FormField
          key={name}
          control={control}
          name={name as Path<T>}
          render={({ field, fieldState }) => (
            <FormItem>
              {underlined ? null : <FormLabel>{label}</FormLabel>}
              <FormControl>
                <Input
                  {...field}
                  autoComplete={autoComplete}
                  disabled={disabled}
                  data-testid={`${testIdPrefix}-${testId}`}
                  {...(underlined && {
                    variant: "underlined",
                    placeholder: label,
                    "aria-label": label,
                    // Half the row each: the wide padding that clears a
                    // password manager's icon would leave no room for a name.
                    className: "px-2",
                    "aria-describedby": fieldState.error
                      ? describedBy
                      : undefined,
                  })}
                />
              </FormControl>
              {underlined ? null : <FormMessage />}
            </FormItem>
          )}
        />
      ))}
    </div>
  );
}
