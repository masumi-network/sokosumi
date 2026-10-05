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
   * On the auth pages each name sits inside its field as the placeholder,
   * centered; the label stays for screen readers and autofill.
   */
  namesInside?: boolean;
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
  namesInside = false,
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
              <FormLabel className={cn(namesInside && "sr-only")}>
                {t(labelKey)}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete={autoComplete}
                  placeholder={namesInside ? t(labelKey) : undefined}
                  className={cn(namesInside && "text-center")}
                  disabled={disabled}
                  data-testid={`${testIdPrefix}-${testId}`}
                />
              </FormControl>
              <FormMessage className={cn(namesInside && "text-center")} />
            </FormItem>
          )}
        />
      ))}
    </div>
  );
}
