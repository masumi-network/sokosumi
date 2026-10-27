"use client";

import type { PublicNewsletterIssueSummary } from "@sokosumi/core-client";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { loadPublicNewsletterIssues } from "@/lib/actions/newsletter/public";

interface ArchiveIssuesProps {
  slug: string;
  initialIssues: PublicNewsletterIssueSummary[];
  initialNextCursor: string | null;
}

export function ArchiveIssues({
  slug,
  initialIssues,
  initialNextCursor,
}: ArchiveIssuesProps) {
  const t = useTranslations("PublicNewsletter");
  const format = useFormatter();
  const [issues, setIssues] = useState(initialIssues);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleLoadMore() {
    if (!nextCursor || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await loadPublicNewsletterIssues({
          slug,
          cursor: nextCursor,
        });
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        setIssues((current) => {
          const seen = new Set(current.map((issue) => issue.publicSlug));
          return [
            ...current,
            ...result.value.data.filter((issue) => !seen.has(issue.publicSlug)),
          ];
        });
        setNextCursor(result.value.meta.pagination.nextCursor);
      } catch {
        setError(t("loadError"));
      }
    });
  }

  if (!issues.length)
    return (
      <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
    );

  return (
    <div className="space-y-6">
      <ul className="divide-y" aria-busy={pending} aria-live="polite">
        {issues.map((issue) => (
          <li key={issue.publicSlug}>
            <Link
              href={`/n/${encodeURIComponent(slug)}/p/${encodeURIComponent(issue.publicSlug)}`}
              className="hover:bg-background-muted focus-visible:ring-ring block space-y-2 rounded-lg p-4 wrap-anywhere focus-visible:ring-2 focus-visible:outline-none"
            >
              <h2 className="text-xl font-semibold">{issue.subject}</h2>
              {issue.previewText ? (
                <p className="text-muted-foreground text-base">
                  {issue.previewText}
                </p>
              ) : null}
              <time
                className="text-muted-foreground text-sm"
                dateTime={new Date(issue.sentAt).toISOString()}
              >
                {format.dateTime(new Date(issue.sentAt), { dateStyle: "long" })}
              </time>
            </Link>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-semantic-destructive-label text-sm">
          {error}
        </p>
      ) : null}
      {nextCursor ? (
        <Button variant="outline" loading={pending} onClick={handleLoadMore}>
          {t("loadMore")}
        </Button>
      ) : null}
    </div>
  );
}
