import "./embed.css";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { NewsletterSignup } from "@/components/newsletter/signup";
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
  return <NewsletterSignup newsletter={newsletter} slug={slug} embed />;
}
