"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Newsletter } from "@sokosumi/core-client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveNewsletterSettings } from "@/lib/actions/newsletter/action";
import {
  type NewsletterSettingsValues,
  newsletterSettingsSchema,
} from "@/lib/schemas/newsletter";

const FONTS = [
  { value: "Arial", label: "arial" },
  { value: "Georgia", label: "georgia" },
  { value: "Verdana", label: "verdana" },
  { value: "Times New Roman", label: "timesNewRoman" },
] as const;

interface NewsletterSettingsFormProps {
  projectId: string;
  projectName: string;
  projectLogo: string | null;
  newsletter: Newsletter | null;
}

export function NewsletterSettingsForm({
  projectId,
  projectName,
  projectLogo,
  newsletter,
}: NewsletterSettingsFormProps) {
  const t = useTranslations("App.Projects.Newsletter");
  const validationT = useTranslations("App.Projects.Newsletter.Validation");
  const router = useRouter();
  const [publicSlug, setPublicSlug] = useState(newsletter?.publicSlug);
  const form = useForm<NewsletterSettingsValues>({
    resolver: zodResolver(newsletterSettingsSchema(validationT)),
    defaultValues: {
      name: newsletter?.name ?? projectName,
      senderName: newsletter?.senderName ?? projectName,
      replyTo: newsletter?.replyTo ?? "",
      logoUrl: newsletter
        ? (newsletter.brand.logoUrl ?? "")
        : (projectLogo ?? ""),
      primaryColor: newsletter?.brand.primaryColor ?? "",
      accentColor: newsletter?.brand.accentColor ?? "",
      fontFamily: newsletter?.brand.fontFamily ?? "Arial",
      footerText: newsletter?.brand.footerText ?? "",
      welcomeEmailEnabled: newsletter?.welcomeEmailEnabled ?? false,
      welcomeSubject: newsletter?.welcomeSubject ?? "",
      welcomeBody: newsletter?.welcomeBody ?? "",
    },
  });
  const welcomeEnabled = useWatch({
    control: form.control,
    name: "welcomeEmailEnabled",
  });
  const selectedFont = useWatch({ control: form.control, name: "fontFamily" });
  const { isSubmitting } = form.formState;

  async function handleSubmit(values: NewsletterSettingsValues) {
    form.clearErrors("root");
    try {
      const result = await saveNewsletterSettings({ projectId, values });
      if (!result.ok) {
        form.setError("root", { message: result.error.message });
        Object.entries(result.error.fieldErrors ?? {}).forEach(
          ([name, errors], index) => {
            form.setError(
              name as keyof NewsletterSettingsValues,
              { message: errors?.[0] },
              { shouldFocus: index === 0 },
            );
          },
        );
        return;
      }
      setPublicSlug(result.value.publicSlug);
      form.reset(values);
      toast.success(t("success"));
      router.refresh();
    } catch {
      form.setError("root", { message: t("error") });
    }
  }

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-8"
      >
        {publicSlug ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("publicAddress")}</p>
            <p className="text-muted-foreground text-sm break-all">
              {publicSlug}
            </p>
          </div>
        ) : null}
        <fieldset disabled={isSubmitting} className="min-w-0 space-y-8">
          <section aria-labelledby="newsletter-general" className="space-y-4">
            <h3 id="newsletter-general" className="text-base font-semibold">
              {t("general")}
            </h3>
            {(["name", "senderName", "replyTo"] as const).map((name) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t(`fields.${name}`)}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type={name === "replyTo" ? "email" : "text"}
                        autoComplete={name === "replyTo" ? "email" : "off"}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </section>

          <section aria-labelledby="newsletter-brand" className="space-y-4">
            <h3 id="newsletter-brand" className="text-base font-semibold">
              {t("brand")}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {(["logoUrl", "primaryColor", "accentColor"] as const).map(
                (name) => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem
                        className={
                          name === "logoUrl" ? "sm:col-span-2" : undefined
                        }
                      >
                        <FormLabel>{t(`fields.${name}`)}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type={name === "logoUrl" ? "url" : "text"}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </FormControl>
                        {name !== "logoUrl" ? (
                          <FormDescription>{t("colorHint")}</FormDescription>
                        ) : null}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ),
              )}
            </div>
            <FormField
              control={form.control}
              name="fontFamily"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.fontFamily")}</FormLabel>
                  <Select
                    name={field.name}
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isSubmitting}
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

          <section aria-labelledby="newsletter-welcome" className="space-y-4">
            <h3 id="newsletter-welcome" className="text-base font-semibold">
              {t("welcome")}
            </h3>
            <FormField
              control={form.control}
              name="welcomeEmailEnabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <FormLabel>{t("fields.welcomeEmailEnabled")}</FormLabel>
                    <FormDescription>{t("welcomeDescription")}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      name={field.name}
                      ref={field.ref}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      onBlur={field.onBlur}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            {welcomeEnabled ? (
              <>
                <FormField
                  control={form.control}
                  name="welcomeSubject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.welcomeSubject")}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="welcomeBody"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.welcomeBody")}</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={6} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : null}
          </section>
        </fieldset>
        {form.formState.errors.root?.message ? (
          <p role="alert" className="text-destructive text-sm">
            {form.formState.errors.root.message}
          </p>
        ) : null}
        <Button type="submit" variant="primary" loading={isSubmitting}>
          {t("save")}
        </Button>
      </form>
    </Form>
  );
}
