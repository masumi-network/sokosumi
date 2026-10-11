import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostMetrics } from "@/app/projects/components/social-posts/social-post-metrics";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import en from "../messages/en.json";

const caseName = process.argv[2] ?? "after-row";

const metrics = {
  views: 0,
  impressions: null,
  likes: 48,
  comments: 6,
  shares: 3,
  saves: null,
};

function PostRow({ strong, recycle }: { strong: boolean; recycle: boolean }) {
  return (
    <li className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {recycle || strong ? (
          <div className="flex min-w-0 items-center gap-2">
            <SocialPostProviderIcon
              provider="x"
              className="size-4 shrink-0"
              aria-hidden
            />
            <p className="truncate font-medium">Launch account</p>
            {strong ? <Badge variant="secondary">Strong</Badge> : null}
          </div>
        ) : (
          <p className="font-medium">Launch account</p>
        )}
        <p className="text-muted-foreground text-xs">
          Oct 1, 2026, 12:15 AM UTC
        </p>
      </div>
      <p className="text-sm break-words whitespace-pre-wrap">
        Launch day is here. The marketplace is live.
      </p>
      <a
        className="inline-block text-sm underline underline-offset-4"
        href="#post"
      >
        Open post on platform
      </a>
      <SocialPostMetrics
        statistics={{
          metrics,
          fetchedAt: new Date("2026-10-08T08:00:00Z"),
          refreshAttemptedAt: null,
          error: null,
        }}
      />
      {recycle ? (
        <Button
          type="button"
          size="sm"
          className="h-11 md:h-8"
          variant="outline"
        >
          Recycle
        </Button>
      ) : null}
    </li>
  );
}

function PerformanceList({ after }: { after: boolean }) {
  return (
    <section className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div className="bg-card-background flex w-full items-center gap-1 self-start overflow-x-auto rounded-lg p-1">
        <span className="text-muted-foreground rounded-md px-3 py-1.5 text-sm font-medium">
          Calendar
        </span>
        <span className="text-muted-foreground rounded-md px-3 py-1.5 text-sm font-medium">
          Drafts
        </span>
        <span className="bg-background text-foreground rounded-md px-3 py-1.5 text-sm font-medium shadow-sm">
          Performance
        </span>
      </div>
      <section className="space-y-4" aria-label="Published account posts">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Published account posts</h3>
          {after ? (
            <p className="text-muted-foreground text-sm">
              Imported from connected platforms. Recycle a strong post to share
              it again.
            </p>
          ) : null}
        </div>
        <ul className="space-y-3">
          <PostRow strong={after} recycle={after} />
        </ul>
      </section>
    </section>
  );
}

function RecycleDialog() {
  return (
    <div className="relative min-h-screen">
      <PerformanceList after />
      <div className="bg-overlay fixed inset-0 grid place-items-center p-4 backdrop-blur-lg">
        <div className="bg-background relative grid w-full max-w-md gap-4 rounded-lg border p-6 shadow-lg">
          <div className="flex flex-col gap-2 text-left">
            <h2 className="text-lg font-semibold">Recycle this post?</h2>
            <p className="text-muted-foreground text-sm">
              Copies the text into a new draft. Nothing goes out on its own.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button type="button">Save as draft</Button>
            <Button type="button" variant="outline">
              In 7 days
            </Button>
            <Button type="button" variant="outline">
              In 14 days
            </Button>
            <Button type="button" variant="outline">
              In 30 days
            </Button>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const cases: Record<string, React.ReactNode> = {
  "before-row": <PerformanceList after={false} />,
  "after-row": <PerformanceList after />,
  "after-dialog": <RecycleDialog />,
};

const node = cases[caseName];
if (!node) {
  throw new Error(`Unknown case: ${caseName}`);
}

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  ),
);
