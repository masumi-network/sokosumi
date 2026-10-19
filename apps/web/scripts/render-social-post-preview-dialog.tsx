import type { SocialPost } from "@sokosumi/core-client";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostPreview } from "@/app/projects/components/social-posts/social-post-preview";
import { SocialPostPreviewFailure } from "@/app/projects/components/social-posts/social-post-preview-failure";
import { createFormats } from "@/i18n/time-format";
import en from "../messages/en.json";

const variant = process.argv[2] ?? "after";

const POST: SocialPost = {
  id: "post-failed",
  projectId: "project-1",
  provider: "x",
  text: "Launch day is here. The clip is ready.",
  media: [],
  status: "FAILED",
  scheduledAt: new Date("2026-09-10T10:00:00.000Z"),
  timezone: "UTC",
  socialConnection: {
    id: "connection-1",
    externalHandle: "sokosumi",
    displayName: "Sokosumi",
    avatarUrl: null,
    status: "active",
  },
  creator: { kind: "user", id: "user-1", name: "Alice" },
  scheduledByUserId: null,
  canceledAt: null,
  publishedAt: null,
  publishedExternalId: null,
  publishedUrl: null,
  lastError: "X rejected the post (403 forbidden)",
  attemptCount: 3,
  nextAttemptAt: null,
  lastAttemptAt: new Date("2026-09-10T10:05:00.000Z"),
  lastAttempt: {
    attempt: 3,
    trigger: "scheduler",
    outcome: "failed_permanent",
    errorKind: "provider_rejected",
    providerOutcome: "403 forbidden",
    finishedAt: new Date("2026-09-10T10:05:00.000Z"),
  },
  revision: 0,
  createdAt: new Date("2026-09-10T09:00:00.000Z"),
  updatedAt: new Date("2026-09-10T10:05:00.000Z"),
  canEdit: true,
  canSchedule: true,
  canCancel: false,
  canPublishNow: true,
  connectionNeedsReconnect: false,
};

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider
      formats={createFormats("h12")}
      locale="en"
      messages={en}
      timeZone="UTC"
    >
      <div
        className="bg-background w-full max-w-md rounded-lg border p-6 shadow-lg"
        data-slot="dialog-content"
      >
        <div className="flex flex-col gap-2 text-left">
          <h2 className="text-lg leading-none font-semibold">Post preview</h2>
          <p className="text-muted-foreground text-sm">Sep 10, 10:00 AM</p>
        </div>
        {variant === "after" ? <SocialPostPreviewFailure post={POST} /> : null}
        <SocialPostPreview
          account={{
            handle: POST.socialConnection?.externalHandle ?? null,
            displayName: POST.socialConnection?.displayName ?? null,
            avatarUrl: POST.socialConnection?.avatarUrl ?? null,
          }}
          media={[]}
          provider="x"
          text={POST.text}
          timestamp={POST.scheduledAt}
        />
        <div className="flex justify-end gap-2">
          <button
            className="bg-secondary text-secondary-foreground inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium"
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    </NextIntlClientProvider>,
  ),
);
