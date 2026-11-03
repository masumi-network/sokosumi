"use client";

import { newsletterSignupLinks } from "@sokosumi/utils";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CopyableValue } from "@/components/copyable-value";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getEnvPublicConfig } from "@/config/env.public";

export function NewsletterSignupCard({ publicSlug }: { publicSlug: string }) {
  const t = useTranslations("App.Projects.Newsletter.SignupForm");
  const newsletterT = useTranslations("App.Projects.Newsletter");
  const { signupUrl, embedHtml: embed } = newsletterSignupLinks(
    publicSlug,
    getEnvPublicConfig().NEXT_PUBLIC_SOKOSUMI_URL,
    t("embedTitle"),
  );

  return (
    <section aria-labelledby="newsletter-signup-card">
      <Card>
        <CardHeader>
          <CardTitle>
            <h3 id="newsletter-signup-card">{t("title")}</h3>
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <section
            aria-labelledby="newsletter-hosted-page"
            className="space-y-2"
          >
            <h4 id="newsletter-hosted-page" className="text-sm font-medium">
              {t("hostedPage")}
            </h4>
            <CopyableValue
              value={signupUrl}
              presentation="inline-code"
              truncateInline={false}
              copiedFeedback
              codeClassName="min-w-0 wrap-anywhere"
              containerClassName="justify-between rounded-md bg-muted p-3"
            />
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link
                  href={signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("open")}
                </Link>
              </Button>
              <Button asChild variant="link" size="sm">
                <Link href={`/n/${encodeURIComponent(publicSlug)}/archive`}>
                  {newsletterT("publicArchive")}
                </Link>
              </Button>
            </div>
          </section>
          <section
            aria-labelledby="newsletter-embed-code"
            className="space-y-2"
          >
            <h4 id="newsletter-embed-code" className="text-sm font-medium">
              {t("embedCode")}
            </h4>
            <CopyableValue
              value={embed}
              presentation="inline-code"
              truncateInline={false}
              copiedFeedback
              codeClassName="min-w-0 whitespace-pre-wrap wrap-anywhere"
              containerClassName="items-start justify-between rounded-md bg-muted p-3"
            />
          </section>
        </CardContent>
      </Card>
    </section>
  );
}
