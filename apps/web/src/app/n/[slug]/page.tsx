import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { NewsletterSignup } from "@/components/newsletter/signup";
import { siteConfig } from "@/config/site";
import { newsletterService } from "@/lib/services/newsletter.service";

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
  const newsletter = await newsletterService.getPublicNewsletter(slug);
  if (!newsletter) notFound();
  return <NewsletterSignup newsletter={newsletter} slug={slug} />;
}
