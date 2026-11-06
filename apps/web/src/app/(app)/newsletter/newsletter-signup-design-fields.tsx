"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NewsletterSettingsValues } from "@/lib/schemas/newsletter";

const CHOICES = {
  buttonShape: ["square", "rounded", "pill"],
  headerAlign: ["left", "center"],
  spacing: ["compact", "normal", "roomy"],
} as const;

export function NewsletterSignupDesignFields({
  disabled,
}: {
  disabled: boolean;
}) {
  const t = useTranslations("App.Projects.Newsletter");
  const form = useFormContext<NewsletterSettingsValues>();
  return (
    <div className="@container min-w-0 space-y-4">
      <p className="text-muted-foreground text-sm">
        {t("SignupForm.customizeDescription")}
      </p>
      <div className="grid gap-4 @lg:grid-cols-2">
        {(["accentColor", "buttonTextColor"] as const).map((name) => (
          <FormField
            key={name}
            control={form.control}
            name={`signupForm.${name}`}
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t(`SignupForm.${name}`)}</FormLabel>
                <div className="flex min-w-0 items-center gap-2">
                  <FormControl>
                    <ColorPicker
                      ref={field.ref}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      disabled={disabled}
                      placeholder={t("SignupForm.useShared")}
                      presetsLabel={t("presetColors")}
                      className="min-w-0 flex-1 [&_button]:h-auto [&_button]:min-h-10 [&_button]:whitespace-normal [&_button]:wrap-anywhere"
                    />
                  </FormControl>
                  {field.value ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t(`SignupForm.clear.${name}`)}
                      onClick={() =>
                        form.setValue(`signupForm.${name}`, "", {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    >
                      <X />
                    </Button>
                  ) : null}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
        {(Object.keys(CHOICES) as (keyof typeof CHOICES)[]).map((name) => (
          <FormField
            key={name}
            control={form.control}
            name={`signupForm.${name}`}
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t(`fields.${name}`)}</FormLabel>
                <Select
                  name={field.name}
                  value={field.value || "shared"}
                  onValueChange={(value) =>
                    field.onChange(value === "shared" ? "" : value)
                  }
                  disabled={disabled}
                >
                  <FormControl>
                    <SelectTrigger
                      ref={field.ref}
                      onBlur={field.onBlur}
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="shared">
                      {t("SignupForm.useShared")}
                    </SelectItem>
                    {CHOICES[name].map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`Design.${name}.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-10 max-w-full whitespace-normal"
        disabled={disabled}
        onClick={() =>
          form.setValue(
            "signupForm",
            {
              accentColor: "",
              buttonTextColor: "",
              buttonShape: "",
              headerAlign: "",
              spacing: "",
            },
            { shouldDirty: true, shouldValidate: true },
          )
        }
      >
        {t("SignupForm.resetOverrides")}
      </Button>
    </div>
  );
}
