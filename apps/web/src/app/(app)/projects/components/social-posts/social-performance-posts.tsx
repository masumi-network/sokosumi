"use client";

import type { SocialPerformanceResponse } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { SocialPostPerformanceCard } from "./social-post-performance-card";

export function SocialPerformancePosts({
  data,
}: {
  data: SocialPerformanceResponse;
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const accountsById = new Map(
    data.accounts.map((account) => [account.id, account]),
  );
  return (
    <section
      className="space-y-4"
      aria-label={t("postsTitle")}
      data-testid="social-performance-posts"
    >
      <h3 className="text-sm font-semibold">{t("postsTitle")}</h3>
      {data.posts.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          {t("empty")}
        </p>
      ) : (
        <ul className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {data.posts.map((post) => (
            <li key={post.id} className="min-w-0">
              <SocialPostPerformanceCard
                post={post}
                account={accountsById.get(post.connectionId)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
