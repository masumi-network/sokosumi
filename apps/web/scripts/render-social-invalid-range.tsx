import { NextIntlClientProvider, useTranslations } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { PostingConsistency } from "@/app/projects/components/social-posts/posting-consistency";
import { SocialPerformanceOverview } from "@/app/projects/components/social-posts/social-performance-overview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import en from "../messages/en.json";

const headline = {
  current: {
    postCount: 12,
    views: null,
    impressions: 400,
    interactions: 18,
  },
  previous: {
    postCount: 10,
    views: null,
    impressions: 420,
    interactions: 15,
  },
  deltas: {
    postCount: 2,
    views: null,
    impressions: -20,
    interactions: 3,
  },
  daily: [
    {
      date: "2026-10-01",
      postCount: 4,
      views: null,
      impressions: 100,
      interactions: 6,
    },
    {
      date: "2026-10-02",
      postCount: 8,
      views: null,
      impressions: 300,
      interactions: 12,
    },
  ],
};

const days = [
  { date: "2026-09-28", posts: 1, engagement: 4 },
  { date: "2026-09-29", posts: 0, engagement: 0 },
  { date: "2026-09-30", posts: 2, engagement: 8 },
  { date: "2026-10-01", posts: 1, engagement: 3 },
];

function Shot({ showMetrics }: { showMetrics: boolean }) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  return (
    <div className="space-y-6" data-testid="social-statistics">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <div className="flex flex-wrap gap-2">
        {(["7", "30", "90"] as const).map((days) => (
          <Button
            key={days}
            size="sm"
            type="button"
            className="text-foreground"
            variant="outline"
          >
            {t("performance.lastDays", { days: Number(days) })}
          </Button>
        ))}
      </div>
      <details className="group" open>
        <summary className="text-muted-foreground flex w-fit cursor-pointer items-center gap-2 rounded-sm py-1 text-sm">
          {t("performance.moreFilters")}
          <span className="text-foreground text-xs">
            {t("performance.activeFilters", { count: 1 })}
          </span>
        </summary>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="statistics-from">{t("publishedFrom")}</Label>
            <Input defaultValue="2026-10-08" id="statistics-from" type="date" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="statistics-until">{t("publishedUntil")}</Label>
            <Input
              aria-invalid
              defaultValue="2026-10-01"
              id="statistics-until"
              type="date"
            />
          </div>
        </div>
      </details>
      <p role="alert" className="text-semantic-destructive text-sm">
        {t("invalidRange")}
      </p>
      {showMetrics ? (
        <>
          <SocialPerformanceOverview headline={headline} impressionBased />
          <PostingConsistency
            days={days}
            selectedFrom="2026-10-08"
            selectedUntil="2026-10-01"
          />
        </>
      ) : null}
      <section className="space-y-4" aria-label={t("postsTitle")}>
        <h3 className="text-sm font-semibold">{t("postsTitle")}</h3>
      </section>
    </div>
  );
}

const showMetrics = process.argv[2] !== "after";

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <Shot showMetrics={showMetrics} />
    </NextIntlClientProvider>,
  ),
);
