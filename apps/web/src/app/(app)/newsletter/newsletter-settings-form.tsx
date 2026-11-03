"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Newsletter } from "@sokosumi/core-client";
import { Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveNewsletterSettings } from "@/lib/actions/newsletter/action";
import {
  type NewsletterSettingsValues,
  newsletterSettingsSchema,
} from "@/lib/schemas/newsletter";
import { cn } from "@/lib/utils";
import { NewsletterBrandPreview } from "./newsletter-brand-preview";
import {
  NewsletterDesignFields,
  newsletterDesignDefaults,
} from "./newsletter-design-fields";

interface NewsletterSettingsFormProps {
  projectId: string;
  projectName: string;
  projectLogo: string | null;
  newsletter: Newsletter | null;
  /** The project's sending domain card, shown below these settings. */
  sendingDomain?: ReactNode;
}

export function NewsletterSettingsForm({
  projectId,
  projectName,
  projectLogo,
  newsletter,
  sendingDomain,
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
      ...newsletterDesignDefaults(newsletter, projectLogo),
      welcomeEmailEnabled: newsletter?.welcomeEmailEnabled ?? false,
      welcomeSubject: newsletter?.welcomeSubject ?? "",
      welcomeBody: newsletter?.welcomeBody ?? "",
    },
  });
  const welcomeEnabled = useWatch({
    control: form.control,
    name: "welcomeEmailEnabled",
  });
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const { isDirty, isSubmitting } = form.formState;
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
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="min-w-0 space-y-4">
          <form
            noValidate
            onSubmit={form.handleSubmit(handleSubmit)}
            className={cn(HOLDER_CLASS, "min-w-0 space-y-3 p-3")}
          >
            {!newsletter && !publicSlug ? (
              <section
                aria-labelledby="newsletter-setup"
                className={cn(HOLDER_ITEM_CLASS, "flex min-w-0 gap-3 p-4")}
              >
                <span
                  aria-hidden
                  className="bg-quinary text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
                >
                  <Mail className="size-5" />
                </span>
                <div className="min-w-0 space-y-1">
                  <h3
                    id="newsletter-setup"
                    className="text-base font-semibold text-balance"
                  >
                    {t("emptyTitle")}
                  </h3>
                  <p className="text-muted-foreground text-sm text-pretty">
                    {t("emptyDescription")}
                  </p>
                </div>
              </section>
            ) : null}
            <fieldset disabled={isSubmitting} className="min-w-0 space-y-3">
              <section aria-labelledby="newsletter-general">
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <h3 id="newsletter-general">{t("general")}</h3>
                    </CardTitle>
                    <CardDescription>{t("generalDescription")}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    {(["name", "senderName", "replyTo"] as const).map(
                      (name) => (
                        <FormField
                          key={name}
                          control={form.control}
                          name={name}
                          render={({ field }) => (
                            <FormItem
                              className={
                                name === "replyTo" ? "md:col-span-2" : undefined
                              }
                            >
                              <FormLabel>{t(`fields.${name}`)}</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  type={name === "replyTo" ? "email" : "text"}
                                  autoComplete={
                                    name === "replyTo" ? "email" : "off"
                                  }
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      ),
                    )}
                  </CardContent>
                </Card>
              </section>

              <section aria-labelledby="newsletter-brand">
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <h3 id="newsletter-brand">{t("brand")}</h3>
                    </CardTitle>
                    <CardDescription>{t("brandDescription")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <NewsletterDesignFields
                      disabled={isSubmitting}
                      onUploadingChange={setIsUploadingLogo}
                    />
                  </CardContent>
                </Card>
              </section>

              <section aria-labelledby="newsletter-welcome">
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <h3 id="newsletter-welcome">{t("welcome")}</h3>
                    </CardTitle>
                    <CardDescription>
                      {t("welcomeCardDescription")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="welcomeEmailEnabled"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between gap-4">
                          <div className="min-w-0 space-y-1">
                            <FormLabel>
                              {t("fields.welcomeEmailEnabled")}
                            </FormLabel>
                            <FormDescription>
                              {t("welcomeDescription")}
                            </FormDescription>
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
                              <FormLabel>
                                {t("fields.welcomeSubject")}
                              </FormLabel>
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
                  </CardContent>
                </Card>
              </section>
            </fieldset>
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 px-1 pb-1">
              <Button
                type="submit"
                variant="primary"
                loading={isSubmitting}
                disabled={isUploadingLogo}
              >
                {t("save")}
              </Button>
              {isDirty && !isSubmitting ? (
                <p className="text-muted-foreground text-sm">
                  {t("unsavedChanges")}
                </p>
              ) : null}
              {form.formState.errors.root?.message ? (
                <p role="alert" className="text-destructive basis-full text-sm">
                  {form.formState.errors.root.message}
                </p>
              ) : null}
            </div>
          </form>
          {/* Its own forms sit outside the settings form: forms don't nest. */}
          {sendingDomain ? (
            <div className={cn(HOLDER_CLASS, "min-w-0 p-3")}>
              {sendingDomain}
            </div>
          ) : null}
        </div>
        <aside className="min-w-0 lg:sticky lg:top-4">
          <NewsletterBrandPreview control={form.control} />
        </aside>
      </div>
    </Form>
  );
}
