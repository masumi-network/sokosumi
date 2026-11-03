"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { PublicNewsletter } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { subscribeToNewsletter } from "@/lib/actions/newsletter/signup";
import {
  type NewsletterSignupValues,
  newsletterSignupSchema,
} from "@/lib/schemas/newsletter-signup";
import { cn } from "@/lib/utils";
import { NEWSLETTER_BUTTON_SHAPE, NEWSLETTER_FORM_SPACING } from "./design";

interface NewsletterSignupFormProps {
  slug: string;
  brand?: PublicNewsletter["brand"];
  preview?: boolean;
}

export function NewsletterSignupForm({
  slug,
  brand = {},
  preview = false,
}: NewsletterSignupFormProps) {
  const t = useTranslations("PublicNewsletter.Signup");
  const publicT = useTranslations("PublicNewsletter");
  const [subscribed, setSubscribed] = useState(false);
  const websiteId = useId();
  const spacing = NEWSLETTER_FORM_SPACING[brand.spacing ?? "normal"];
  const form = useForm<NewsletterSignupValues>({
    resolver: zodResolver(newsletterSignupSchema(t)),
    defaultValues: { email: "", name: "", consent: false, website: "" },
  });
  const { isSubmitting } = form.formState;

  async function handleSubmit(values: NewsletterSignupValues) {
    if (preview) return;
    form.clearErrors("root");
    try {
      const result = await subscribeToNewsletter({ slug, values });
      if (!result.ok) {
        form.setError("root", { message: result.error.message });
        Object.entries(result.error.fieldErrors ?? {}).forEach(
          ([name, messages], index) => {
            form.setError(
              name as keyof NewsletterSignupValues,
              { message: messages?.[0] },
              { shouldFocus: index === 0 },
            );
          },
        );
        return;
      }
      setSubscribed(true);
    } catch {
      form.setError("root", { message: t("error") });
    }
  }

  return (
    <div>
      <p role="status" className="text-sm leading-relaxed">
        {subscribed ? t("success") : null}
      </p>
      {!subscribed ? (
        <Form {...form}>
          <form
            noValidate
            inert={preview}
            onSubmit={
              preview
                ? (event) => event.preventDefault()
                : form.handleSubmit(handleSubmit)
            }
            className={spacing}
          >
            <fieldset
              disabled={isSubmitting}
              className={cn("min-w-0", spacing)}
            >
              {(["email", "name"] as const).map((name) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t(name)}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type={name === "email" ? "email" : "text"}
                          autoComplete={name}
                          maxLength={name === "email" ? 254 : 200}
                          required={name === "email"}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
              <FormField
                control={form.control}
                name="consent"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-start gap-3">
                      <FormControl>
                        <Checkbox
                          name={field.name}
                          ref={field.ref}
                          checked={field.value}
                          onCheckedChange={(value) =>
                            field.onChange(value === true)
                          }
                          onBlur={field.onBlur}
                          required
                          className="mt-0.5"
                        />
                      </FormControl>
                      <FormLabel className="text-sm leading-relaxed font-normal">
                        {t("consent")}
                      </FormLabel>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div hidden>
                <label htmlFor={websiteId}>{t("website")}</label>
                <Input
                  id={websiteId}
                  {...form.register("website")}
                  autoComplete="off"
                  tabIndex={-1}
                  maxLength={2048}
                />
              </div>
            </fieldset>
            {form.formState.errors.root?.message ? (
              <p role="alert" className="text-destructive text-sm">
                {form.formState.errors.root.message}
              </p>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              loading={isSubmitting}
              className={cn(
                "w-full",
                NEWSLETTER_BUTTON_SHAPE[brand.buttonShape ?? "rounded"],
              )}
              style={{
                backgroundColor: brand.accentColor,
                color: brand.buttonTextColor,
              }}
            >
              {publicT("subscribe")}
            </Button>
          </form>
        </Form>
      ) : null}
    </div>
  );
}
