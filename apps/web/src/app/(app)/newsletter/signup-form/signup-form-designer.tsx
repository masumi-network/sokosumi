"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Newsletter } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { newsletterDesignDefaults } from "@/app/newsletter/newsletter-design-fields";
import { NewsletterDesignPanel } from "@/app/newsletter/newsletter-design-panel";
import { NewsletterSignupCard } from "@/app/newsletter/newsletter-signup-card";
import { NewsletterSignup } from "@/components/newsletter/signup";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type NewsletterSettingsValues,
  newsletterBrandForPreview,
  newsletterSettingsSchema,
} from "@/lib/schemas/newsletter";
import { cn } from "@/lib/utils";

export function NewsletterSignupDesigner({
  newsletter,
  projectId,
}: {
  newsletter: Newsletter;
  projectId: string;
}) {
  const t = useTranslations("App.Projects.Newsletter.SignupForm");
  const validationT = useTranslations("App.Projects.Newsletter.Validation");
  const [preview, setPreview] = useState("hosted");
  const defaults: NewsletterSettingsValues = {
    name: newsletter.name,
    senderName: newsletter.senderName,
    replyTo: newsletter.replyTo,
    welcomeEmailEnabled: newsletter.welcomeEmailEnabled,
    welcomeSubject: newsletter.welcomeSubject ?? "",
    welcomeBody: newsletter.welcomeBody ?? "",
    ...newsletterDesignDefaults(newsletter),
  };
  const form = useForm<NewsletterSettingsValues>({
    resolver: zodResolver(newsletterSettingsSchema(validationT)),
    defaultValues: defaults,
  });
  const design = useWatch({ control: form.control });
  const brand = newsletterBrandForPreview({ ...defaults, ...design });
  return (
    <div
      className={cn(
        HOLDER_CLASS,
        "grid min-w-0 items-start gap-4 p-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
      )}
    >
      <div className="min-w-0 space-y-4">
        <NewsletterDesignPanel form={form} projectId={projectId} signupForm />
        <NewsletterSignupCard publicSlug={newsletter.publicSlug} />
      </div>
      <aside
        aria-labelledby="newsletter-signup-preview"
        className="min-w-0 xl:sticky xl:top-4"
      >
        <Card>
          <CardHeader>
            <CardTitle>
              <h3 id="newsletter-signup-preview">{t("previewTitle")}</h3>
            </CardTitle>
            <CardDescription>{t("previewDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 space-y-4">
            <Tabs value={preview} onValueChange={setPreview}>
              <TabsList
                aria-label={t("previewMode")}
                className="h-auto w-full items-stretch"
              >
                <TabsTrigger
                  value="hosted"
                  className="h-auto min-h-10 min-w-0 whitespace-normal"
                >
                  {t("hostedPage")}
                </TabsTrigger>
                <TabsTrigger
                  value="embed"
                  className="h-auto min-h-10 min-w-0 whitespace-normal"
                >
                  {t("embedTitle")}
                </TabsTrigger>
              </TabsList>
              {(["hosted", "embed"] as const).map((mode) => (
                <TabsContent key={mode} value={mode}>
                  <NewsletterSignup
                    newsletter={{ ...newsletter, brand }}
                    slug={newsletter.publicSlug}
                    embed={mode === "embed"}
                    preview
                  />
                </TabsContent>
              ))}
            </Tabs>
            <p className="text-muted-foreground text-xs">{t("previewNote")}</p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
