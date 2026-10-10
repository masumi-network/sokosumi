import type { SocialPost } from "@sokosumi/core-client";
import {
  NextIntlClientProvider,
  useFormatter,
  useTranslations,
} from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SOCIAL_METRIC_KEYS,
  SocialPostMetrics,
} from "@/app/projects/components/social-posts/social-post-metrics";
import { createFormats } from "@/i18n/time-format";
import en from "../messages/en.json";

const hideEmpty = process.argv[2] !== "before";

const fetchedAt = new Date("2026-10-08T12:00:00.000Z");

const statistics: NonNullable<SocialPost["statistics"]> = {
  metrics: {
    views: 0,
    impressions: null,
    likes: 5,
    comments: null,
    shares: 1,
    saves: null,
  },
  fetchedAt,
  refreshAttemptedAt: null,
  error: null,
};

function LegacyFullMetrics() {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const formatter = useFormatter();
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {SOCIAL_METRIC_KEYS.map((key) => {
          const value = statistics.metrics[key];
          return (
            <div key={key} className="space-y-1">
              <dt className="text-muted-foreground">{t(`metrics.${key}`)}</dt>
              <dd className="font-medium tabular-nums">
                {value == null ? t("unavailable") : formatter.number(value)}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="text-muted-foreground text-xs">
        {t("updatedAt", {
          date: formatter.dateTime(fetchedAt, "dateTime"),
        })}
      </p>
    </div>
  );
}

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider
      formats={createFormats()}
      locale="en"
      messages={en}
      timeZone="UTC"
    >
      <article
        className="w-[36rem] space-y-3 rounded-lg border p-4"
        data-testid="hide-unavailable-metrics"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-medium">Launch account</p>
          <p className="text-muted-foreground text-xs">Oct 1, 2026</p>
        </div>
        <p className="text-sm">Published outside Sokosumi</p>
        {hideEmpty ? (
          <SocialPostMetrics statistics={statistics} />
        ) : (
          <LegacyFullMetrics />
        )}
      </article>
    </NextIntlClientProvider>,
  ),
);
