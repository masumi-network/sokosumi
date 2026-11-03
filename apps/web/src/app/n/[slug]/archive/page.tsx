import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { siteConfig } from "@/config/site";
import { newsletterService } from "@/lib/services/newsletter.service";
import { PublicNewsletterHeader } from "../public-newsletter-header";
import { ArchiveIssues } from "./archive-issues";

export const instant = false;

interface ArchivePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: ArchivePageProps): Promise<Metadata> {
  const { slug } = await params;
  const [newsletter, t] = await Promise.all([
    newsletterService.getPublicNewsletter(slug),
    getTranslations("PublicNewsletter"),
  ]);
  if (!newsletter) notFound();
  const title = t("metadataTitle", { name: newsletter.name });
  const description = t("metadataDescription", { name: newsletter.name });
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `${siteConfig.url}/n/${encodeURIComponent(slug)}/archive`,
    },
  };
}

export default async function ArchivePage({ params }: ArchivePageProps) {
  const { slug } = await params;
  const [newsletter, issues, t] = await Promise.all([
    newsletterService.getPublicNewsletter(slug),
    newsletterService.listPublicIssues(slug, {}),
    getTranslations("PublicNewsletter"),
  ]);
  if (!newsletter || !issues) notFound();
  return (
    <>
      <PublicNewsletterHeader
        newsletter={newsletter}
        slug={slug}
        subscribeLabel={t("subscribe")}
      />
      <section className="space-y-6" aria-labelledby="archive-heading">
        <h1
          id="archive-heading"
          className="text-3xl font-semibold tracking-tight"
        >
          {t("archive")}
        </h1>
        <ArchiveIssues
          key={slug}
          slug={slug}
          initialIssues={issues.data}
          initialNextCursor={issues.meta.pagination.nextCursor}
        />
      </section>
    </>
  );
}
