import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { NewsletterSignupForm } from "@/components/newsletter/signup-form";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { newsletterService } from "@/lib/services/newsletter.service";
import { PublicNewsletterHeader } from "./public-newsletter-header";

export const instant = false;

interface SignupPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: SignupPageProps): Promise<Metadata> {
  const { slug } = await params;
  const [newsletter, t] = await Promise.all([
    newsletterService.getPublicNewsletter(slug),
    getTranslations("PublicNewsletter.Signup"),
  ]);
  if (!newsletter) notFound();
  const title = t("title", { name: newsletter.name });
  const description = t("description");
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `${siteConfig.url}/n/${encodeURIComponent(slug)}`,
    },
  };
}

export default async function SignupPage({ params }: SignupPageProps) {
  const { slug } = await params;
  const [newsletter, t] = await Promise.all([
    newsletterService.getPublicNewsletter(slug),
    getTranslations("PublicNewsletter.Signup"),
  ]);
  if (!newsletter) notFound();
  return (
    <>
      <PublicNewsletterHeader newsletter={newsletter} slug={slug} />
      <section
        aria-labelledby="signup-heading"
        className="mx-auto max-w-md space-y-6"
      >
        <div className="space-y-2">
          <h1
            id="signup-heading"
            className="text-2xl font-semibold tracking-tight wrap-anywhere"
          >
            {t("title", { name: newsletter.name })}
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t("description")}
          </p>
        </div>
        <NewsletterSignupForm key={slug} slug={slug} />
        <Button asChild variant="link" className="px-0">
          <Link href={`/n/${encodeURIComponent(slug)}/archive`}>
            {t("archive")}
          </Link>
        </Button>
      </section>
    </>
  );
}
