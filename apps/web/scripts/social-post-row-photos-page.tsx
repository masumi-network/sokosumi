/** Playwright capture page for Social draft-row account photos. */
import type { ProjectSocialConnection } from "@sokosumi/core-client";
import { NextIntlClientProvider } from "next-intl";
import { createRoot } from "react-dom/client";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { AccountChipMark } from "@/components/social-account-chip-mark";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { createFormats } from "@/i18n/time-format";
import messages from "@/messages/en.json";

const PHOTO_X = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#111"/><circle cx="32" cy="24" r="11" fill="#f4d0b5"/><ellipse cx="32" cy="54" rx="18" ry="14" fill="#2a2a2a"/></svg>`,
)}`;
const PHOTO_LINKEDIN = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#0a66c2"/><circle cx="32" cy="24" r="11" fill="#f8d7b8"/><ellipse cx="32" cy="54" rx="18" ry="14" fill="#084b8a"/></svg>`,
)}`;

const ROWS: {
  id: string;
  provider: ProjectSocialConnection["provider"];
  handle: string;
  avatarUrl: string | null;
  text: string;
}[] = [
  {
    id: "x",
    provider: "x",
    handle: "@sokosumi",
    avatarUrl: PHOTO_X,
    text: "Launch note for Monday.",
  },
  {
    id: "instagram",
    provider: "instagram",
    handle: "@sokosumi_studio",
    avatarUrl: null,
    text: "Studio stills later today.",
  },
  {
    id: "linkedin",
    provider: "linkedin",
    handle: "@sokosumi",
    avatarUrl: PHOTO_LINKEDIN,
    text: "Hiring note for the feed.",
  },
];

function RowMark({
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
      <span
        aria-hidden
        className="bg-background flex size-9 shrink-0 items-center justify-center rounded-md border"
      >
        <SocialPostProviderIcon className="size-5" provider={provider} />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center"
    >
      <AccountChipMark avatarUrl={avatarUrl} provider={provider} />
    </span>
  );
}

export function RowPhotosPage() {
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
        <ul className="mx-auto grid w-full max-w-xl list-none gap-2 p-0">
          {ROWS.map((row) => (
            <li
              className="bg-background border-border flex flex-wrap items-start gap-3 rounded-lg border p-3"
              data-testid={`social-post-post-${row.id}`}
              key={row.id}
            >
              <RowMark
                avatarUrl={row.avatarUrl}
                phase={phase}
                provider={row.provider}
              />
              <div className="min-w-48 flex-1 space-y-1.5">
                <p className="text-muted-foreground flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <SocialPostStatusBadge
                    className="order-first"
                    label="Draft"
                    status="DRAFT"
                  />
                  <span className="min-w-0 truncate">{row.handle}</span>
                </p>
                <p className="text-sm whitespace-pre-wrap break-words">
                  {row.text}
                </p>
                <p className="text-muted-foreground text-xs">User · Alice</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </NextIntlClientProvider>
  );
}

export function mountRowPhotosPage() {
  const root = document.getElementById("fixture");
  if (!root) throw new Error("Missing #fixture");
  createRoot(root).render(<RowPhotosPage />);
}

if (typeof document !== "undefined" && document.getElementById("fixture")) {
  try {
    mountRowPhotosPage();
  } catch (error) {
    document.body.dataset.moduleError = String(error);
  }
}
