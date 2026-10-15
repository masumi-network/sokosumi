import type { SocialPost } from "@sokosumi/core-client";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostMetrics } from "@/app/projects/components/social-posts/social-post-metrics";
import { Button } from "@/components/ui/button";
import { createFormats } from "@/i18n/time-format";
import en from "../messages/en.json";

const EMPTY: SocialPost["statistics"] = undefined;

const PARTIAL: NonNullable<SocialPost["statistics"]> = {
  metrics: {
    views: 0,
    impressions: null,
    likes: 12,
    comments: null,
    shares: null,
    saves: null,
  },
  fetchedAt: new Date("2026-10-08T12:00:00.000Z"),
  refreshAttemptedAt: null,
  error: null,
};

const CASES = { empty: EMPTY, partial: PARTIAL } as const;

function caseOf(name: string): SocialPost["statistics"] {
  if (name === "empty" || name === "partial") return CASES[name];
  throw new Error(`Unknown metrics case: ${name}`);
}

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider
      formats={createFormats()}
      locale="en"
      messages={en}
      timeZone="UTC"
    >
      <article className="bg-background text-foreground space-y-3 rounded-lg border p-4">
        <p className="text-sm">Launch day is here.</p>
        <SocialPostMetrics
          compact
          statistics={caseOf(process.argv[2] ?? "empty")}
        />
        <Button
          className="min-h-11 md:min-h-8"
          size="sm"
          type="button"
          variant="outline"
        >
          {en.App.Projects.SocialPosts.statistics.refresh}
        </Button>
      </article>
    </NextIntlClientProvider>,
  ),
);
