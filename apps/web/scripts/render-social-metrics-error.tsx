import type { SocialPost } from "@sokosumi/core-client";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostMetrics } from "@/app/projects/components/social-posts/social-post-metrics";
import { createFormats } from "@/i18n/time-format";
import en from "../messages/en.json";

const variant = process.argv[2] ?? "after";

const statistics = {
  metrics: {
    views: 0,
    impressions: 12,
    likes: null,
    comments: 3,
    shares: null,
    saves: null,
  },
  fetchedAt: null,
  refreshAttemptedAt: new Date("2026-10-08T12:00:00.000Z"),
  error: "rate limited",
} satisfies NonNullable<SocialPost["statistics"]>;

const beforeCopy =
  "Failed to refresh statistics. Previous results are retained. Check the connected account and permissions, then try again.";

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider
      formats={createFormats("h12")}
      locale="en"
      messages={en}
      timeZone="UTC"
    >
      <div className="bg-background w-full max-w-md rounded-lg border p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">Post preview</h2>
        {variant === "before" ? (
          <div className="space-y-2">
            <SocialPostMetrics statistics={{ ...statistics, error: null }} />
            <p role="status" className="text-semantic-warning text-xs">
              {beforeCopy}
            </p>
          </div>
        ) : (
          <SocialPostMetrics statistics={statistics} />
        )}
      </div>
    </NextIntlClientProvider>,
  ),
);
