import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PreviewFrame } from "@/components/common/preview-frame";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { newsletterService } from "@/lib/services/newsletter.service";
import { PublicNewsletterHeader } from "../../public-newsletter-header";

export const instant = false;

interface PublicIssuePageProps {
  params: Promise<{ slug: string; issueSlug: string }>;
}

export async function generateMetadata({
  params,
}: PublicIssuePageProps): Promise<Metadata> {
  const [{ slug, issueSlug }, locale] = await Promise.all([
    params,
    getLocale(),
  ]);
  const [newsletter, issue] = await Promise.all([
    newsletterService.getPublicNewsletter(slug),
    newsletterService.getPublicIssue(slug, issueSlug, locale),
  ]);
  if (!newsletter || !issue) notFound();
  const description = issue.previewText || newsletter.name;
  return {
    title: issue.subject,
    description,
    openGraph: {
      title: issue.subject,
      description,
      type: "article",
      siteName: newsletter.name,
      publishedTime: new Date(issue.sentAt).toISOString(),
      url: `${siteConfig.url}/n/${encodeURIComponent(slug)}/p/${encodeURIComponent(issueSlug)}`,
    },
  };
}

export default async function PublicIssuePage({
  params,
}: PublicIssuePageProps) {
  const [{ slug, issueSlug }, locale] = await Promise.all([
    params,
    getLocale(),
  ]);
  const [newsletter, issue, t, format] = await Promise.all([
    newsletterService.getPublicNewsletter(slug),
    newsletterService.getPublicIssue(slug, issueSlug, locale),
    getTranslations("PublicNewsletter"),
    getFormatter(),
  ]);
  if (!newsletter || !issue) notFound();
  return (
    <>
      <Button asChild variant="outline">
        <Link href={`/n/${encodeURIComponent(slug)}/archive`}>
          {t("backToArchive")}
        </Link>
      </Button>
      <PublicNewsletterHeader
        newsletter={newsletter}
        slug={slug}
        subscribeLabel={t("subscribe")}
      />
      <article className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight wrap-anywhere">
            {issue.subject}
          </h1>
          <time
            className="text-muted-foreground text-sm"
            dateTime={new Date(issue.sentAt).toISOString()}
          >
            {format.dateTime(new Date(issue.sentAt), { dateStyle: "long" })}
          </time>
        </div>
        <PreviewFrame>
          <iframe
            title={t("issueContent", { subject: issue.subject })}
            srcDoc={issue.html}
            // Email links open in a new tab; scripts and same-origin stay off.
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            className="min-h-[48rem] w-full border-0"
          />
        </PreviewFrame>
      </article>
    </>
  );
}
