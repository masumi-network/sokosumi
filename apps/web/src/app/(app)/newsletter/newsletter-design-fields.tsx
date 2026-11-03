"use client";

import type { Newsletter } from "@sokosumi/core-client";
import { ORGANIZATION_LOGO_MAX_SIZE_BYTES } from "@sokosumi/utils";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFormContext, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  FormControl,
  FormDescription,
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
import { Textarea } from "@/components/ui/textarea";
import type { NewsletterSettingsValues } from "@/lib/schemas/newsletter";
import { formatBytes } from "@/lib/utils/format-bytes";
import { NewsletterImageUpload } from "./newsletter-image-upload";

const FONTS = [
  { value: "Arial", label: "arial" },
  { value: "Helvetica", label: "helvetica" },
  { value: "Georgia", label: "georgia" },
  { value: "Verdana", label: "verdana" },
  { value: "Trebuchet MS", label: "trebuchet" },
  { value: "Times New Roman", label: "timesNewRoman" },
] as const;

const COLORS = [
  "primaryColor",
  "accentColor",
  "backgroundColor",
  "buttonTextColor",
] as const;

const CHOICES = {
  headerAlign: ["left", "center"],
  spacing: ["compact", "normal", "roomy"],
  buttonShape: ["square", "rounded", "pill"],
} as const;

type DesignFieldValues = Pick<
  NewsletterSettingsValues,
  | "logoUrl"
  | "primaryColor"
  | "accentColor"
  | "fontFamily"
  | "footerText"
  | "backgroundColor"
  | "buttonTextColor"
  | "buttonShape"
  | "headerImageUrl"
  | "headerAlign"
  | "spacing"
>;

/** The form's design fields from a saved newsletter, or a new one's defaults. */
export function newsletterDesignDefaults(
  newsletter: Newsletter | null,
  projectLogo: string | null = null,
): DesignFieldValues {
  const brand = newsletter?.brand;
  return {
    logoUrl: newsletter ? (brand?.logoUrl ?? "") : (projectLogo ?? ""),
    primaryColor: brand?.primaryColor ?? "",
    accentColor: brand?.accentColor ?? "",
    fontFamily: brand?.fontFamily ?? "Arial",
    footerText: brand?.footerText ?? "",
    backgroundColor: brand?.backgroundColor ?? "",
    buttonTextColor: brand?.buttonTextColor ?? "",
    buttonShape: brand?.buttonShape ?? "rounded",
    headerImageUrl: brand?.headerImageUrl ?? "",
    headerAlign: brand?.headerAlign ?? "left",
    spacing: brand?.spacing ?? "normal",
  };
}

function GroupLabel({ children }: { children: string }) {
  return (
    <h4 className="text-muted-foreground text-xs font-medium">{children}</h4>
  );
}

/**
 * Logo, header, colors, type, layout and footer of the newsletter email. Lives
 * in a `NewsletterSettingsValues` form; the settings page and the issue studio
 * both save it through `saveNewsletterSettings`.
 */
export function NewsletterDesignFields({
  disabled,
  onUploadingChange,
}: {
  disabled: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const t = useTranslations("App.Projects.Newsletter");
  const form = useFormContext<NewsletterSettingsValues>();
  const selectedFont = useWatch({ control: form.control, name: "fontFamily" });
  const setUrl = (name: "logoUrl" | "headerImageUrl") => (url: string) =>
    form.setValue(name, url, { shouldDirty: true, shouldValidate: true });

  return (
    <div className="@container min-w-0 space-y-6">
      <section className="space-y-4">
        <GroupLabel>{t("Design.header")}</GroupLabel>
        <div className="grid gap-4 @lg:grid-cols-2">
          {(["logoUrl", "headerImageUrl"] as const).map((name) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t(`fields.${name}`)}</FormLabel>
                  <div className="flex min-w-0 items-center gap-4">
                    <FormControl>
                      <NewsletterImageUpload
                        kind={name === "logoUrl" ? "logo" : "image"}
                        value={field.value}
                        onChange={setUrl(name)}
                        disabled={disabled}
                        onUploadingChange={onUploadingChange}
                      />
                    </FormControl>
                    <FormDescription className="min-w-0 flex-1">
                      {t(
                        name === "logoUrl"
                          ? "Logo.description"
                          : "Image.headerDescription",
                        {
                          maxSize: formatBytes(
                            ORGANIZATION_LOGO_MAX_SIZE_BYTES,
                          ),
                        },
                      )}
                    </FormDescription>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <GroupLabel>{t("Design.colors")}</GroupLabel>
        <div className="grid gap-4 @lg:grid-cols-2">
          {COLORS.map((name) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t(`fields.${name}`)}</FormLabel>
                  <div className="flex min-w-0 items-center gap-2">
                    <FormControl>
                      <ColorPicker
                        ref={field.ref}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        disabled={disabled}
                        placeholder={t("colorPlaceholder")}
                        presetsLabel={t("presetColors")}
                        className="min-w-0 flex-1"
                      />
                    </FormControl>
                    {field.value ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t(`clearColor.${name}`)}
                        onClick={() =>
                          form.setValue(name, "", {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                      >
                        <X />
                      </Button>
                    ) : null}
                  </div>
                  <FormDescription>{t(`colorHints.${name}`)}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <GroupLabel>{t("Design.layout")}</GroupLabel>
        <div className="grid gap-4 @lg:grid-cols-2">
          <FormField
            control={form.control}
            name="fontFamily"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t("fields.fontFamily")}</FormLabel>
                <Select
                  name={field.name}
                  value={field.value}
                  onValueChange={field.onChange}
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
                    {FONTS.map((font) => (
                      <SelectItem key={font.value} value={font.value}>
                        {t(`fonts.${font.label}`)}
                      </SelectItem>
                    ))}
                    {!FONTS.some((font) => font.value === selectedFont) ? (
                      <SelectItem value={selectedFont}>
                        {selectedFont}
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          {(Object.keys(CHOICES) as (keyof typeof CHOICES)[]).map((name) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t(`fields.${name}`)}</FormLabel>
                  <Select
                    name={field.name}
                    value={field.value}
                    onValueChange={field.onChange}
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
      </section>

      <section className="space-y-4">
        <GroupLabel>{t("Design.footer")}</GroupLabel>
        <FormField
          control={form.control}
          name="footerText"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("fields.footerText")}</FormLabel>
              <FormControl>
                <Textarea {...field} rows={3} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </section>
    </div>
  );
}
