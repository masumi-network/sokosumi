import "./embed.css";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { NewsletterSignupForm } from "@/components/newsletter/signup-form";
import { newsletterService } from "@/lib/services/newsletter.service";

export const instant = false;

interface EmbedPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: EmbedPageProps): Promise<Metadata> {
  const { slug } = await params;
  const [newsletter, t] = await Promise.all([
    newsletterService.getPublicNewsletter(slug),
    getTranslations("PublicNewsletter.Signup"),
  ]);
  if (!newsletter) notFound();
  return {
    title: t("title", { name: newsletter.name }),
    robots: { index: false, follow: false },
  };
}

export default async function EmbedPage({ params }: EmbedPageProps) {
  const { slug } = await params;
  const newsletter = await newsletterService.getPublicNewsletter(slug);
  if (!newsletter) notFound();
  return (
    <section data-newsletter-embed className="space-y-4">
      <h1 className="text-lg font-semibold wrap-anywhere">{newsletter.name}</h1>
      <NewsletterSignupForm key={slug} slug={slug} />
    </section>
  );
}
