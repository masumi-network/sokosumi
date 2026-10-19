/** Playwright capture page for Social calendar preview account photos. */
import type { ProjectSocialConnection } from "@sokosumi/core-client";
import { NextIntlClientProvider } from "next-intl";
import { createRoot } from "react-dom/client";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { AccountChipMark } from "@/components/social-account-chip-mark";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { createFormats } from "@/i18n/time-format";
import messages from "@/messages/en.json";

const PHOTO = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#111"/><circle cx="32" cy="24" r="11" fill="#f4d0b5"/><ellipse cx="32" cy="54" rx="18" ry="14" fill="#2a2a2a"/></svg>`,
)}`;

const CARDS: {
  id: string;
  provider: ProjectSocialConnection["provider"];
  handle: string;
  avatarUrl: string | null;
  project: string;
  text: string;
}[] = [
  {
    id: "x",
    provider: "x",
    handle: "@sokosumi",
    avatarUrl: PHOTO,
    project: "Launch project",
    text: "Launch note for Monday.",
  },
  {
    id: "instagram",
    provider: "instagram",
    handle: "@sokosumi_studio",
    avatarUrl: null,
    project: "Studio",
    text: "Studio stills later today.",
  },
];

function CardMark({
  avatarUrl,
  phase,
  provider,
}: {
  avatarUrl: string | null;
  phase: "before" | "after";
  provider: ProjectSocialConnection["provider"];
}) {
  if (phase === "before") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center">
        <SocialPostProviderIcon className="size-3" provider={provider} />
      </span>
    );
  }

  return (
    <span className="flex size-6 shrink-0 items-center justify-center">
      <AccountChipMark avatarUrl={avatarUrl} provider={provider} />
    </span>
  );
}

export function CalendarPreviewPhotosPage() {
  const phase =
    new URLSearchParams(window.location.search).get("phase") === "before"
      ? "before"
      : "after";

  useMountEffect(() => {
    document.body.dataset.hydrated = "true";
  });

  return (
    <NextIntlClientProvider
      formats={createFormats("h23")}
      locale="en"
      messages={messages}
      timeZone="UTC"
    >
      <div className="bg-muted p-6">
        <div className="mx-auto grid w-72 max-w-full gap-2">
          {CARDS.map((card) => (
            <article
              className="bg-background border-border flex w-full min-w-0 flex-col items-stretch gap-1 overflow-hidden rounded-md border p-1.5 text-left text-xs font-medium"
              data-testid={`calendar-social-post-${card.id}`}
              key={card.id}
            >
              <span className="flex w-full min-w-0 items-center gap-1">
                <CardMark
                  avatarUrl={card.avatarUrl}
                  phase={phase}
                  provider={card.provider}
                />
                <span className="min-w-0 flex-1 truncate">{card.handle}</span>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  12:00
                </span>
              </span>
              <span className="text-muted-foreground w-full min-w-0 truncate font-normal">
                {card.project}
              </span>
              <span className="line-clamp-2 w-full min-w-0 break-words font-normal">
                {card.text}
              </span>
              <SocialPostStatusBadge label="Scheduled" status="SCHEDULED" />
            </article>
          ))}
        </div>
      </div>
    </NextIntlClientProvider>
  );
}

export function mountCalendarPreviewPhotosPage() {
  const root = document.getElementById("fixture");
  if (!root) throw new Error("Missing #fixture");
  createRoot(root).render(<CalendarPreviewPhotosPage />);
}

if (typeof document !== "undefined" && document.getElementById("fixture")) {
  try {
    mountCalendarPreviewPhotosPage();
  } catch (error) {
    document.body.dataset.moduleError = String(error);
  }
}
