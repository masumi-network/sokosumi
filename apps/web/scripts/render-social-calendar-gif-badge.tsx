import {
  NextIntlClientProvider,
  useFormatter,
  useTranslations,
} from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { createFormats } from "@/i18n/time-format";
import en from "../messages/en.json";

const showGifBadge = process.argv[2] !== "before";

const PREVIEW_SRC =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#2563eb"/><circle cx="210" cy="70" r="36" fill="#f8fafc"/></svg>`,
  );

function CalendarGifCard() {
  const t = useTranslations("App.Calendar.socialPost");
  const statuses = useTranslations("App.Projects.SocialPosts.status");
  const formatter = useFormatter();
  const scheduledAt = new Date("2026-10-08T12:00:00.000Z");

  return (
    <div
      className="bg-background text-foreground border-border flex w-72 min-w-0 flex-col items-stretch gap-1 overflow-hidden rounded-md border p-1.5 text-left text-xs font-medium"
      data-testid="calendar-gif-badge"
    >
      <span className="flex w-full min-w-0 items-center gap-1">
        <span className="flex size-4 shrink-0 items-center justify-center">
          <SocialPostProviderIcon
            provider="x"
            role="img"
            aria-label="X · @sokosumi"
            className="size-3"
          />
        </span>
        <span aria-hidden className="min-w-0 flex-1 truncate">
          @sokosumi
        </span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {formatter.dateTime(scheduledAt, "time", { timeZone: "UTC" })}
        </span>
      </span>
      <span className="text-muted-foreground w-full min-w-0 truncate font-normal">
        Launch project
      </span>
      <span
        aria-hidden
        className="bg-muted relative block aspect-video w-full overflow-hidden rounded"
      >
        <img
          alt=""
          className="size-full object-cover"
          decoding="async"
          src={PREVIEW_SRC}
        />
        {showGifBadge ? (
          <span
            className="bg-scrim-strong text-on-media absolute bottom-1 start-1 rounded px-1.5 py-0.5 text-2xs font-semibold"
            data-testid="calendar-social-post-gif"
          >
            GIF
          </span>
        ) : null}
      </span>
      <span className="line-clamp-2 w-full min-w-0 break-words font-normal">
        Launch loop
      </span>
      <span className="flex w-full min-w-0 items-center gap-1">
        <SocialPostStatusBadge
          status="SCHEDULED"
          label={statuses("SCHEDULED")}
          showLabel={false}
        />
        <span className="sr-only">{t("scheduledBy", { name: "Albina" })}</span>
      </span>
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
      <CalendarGifCard />
    </NextIntlClientProvider>,
  ),
);
