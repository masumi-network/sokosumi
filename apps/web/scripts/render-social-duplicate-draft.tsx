import {
  ExternalLink,
  Eye,
  MoreHorizontal,
  RotateCcw,
  XIcon,
} from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostPreview } from "@/app/projects/components/social-posts/social-post-preview";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { Button } from "@/components/ui/button";
import en from "../messages/en.json";

const caseName = process.argv[2] ?? "after-preview";

function ActionsMenu({ open }: { open: boolean }) {
  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Post actions"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </Button>
      {open ? (
        <div
          className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-1 min-w-[10rem] rounded-md border p-1 shadow-md"
          role="menu"
        >
          <div className="relative flex min-h-11 cursor-default items-center rounded-sm px-2 py-1.5 text-sm">
            Duplicate as draft
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PreviewCase({ showDuplicate }: { showDuplicate: boolean }) {
  return (
    <div className="bg-overlay fixed inset-0 grid place-items-center p-4 backdrop-blur-lg">
      <div className="bg-background relative grid w-full max-w-md gap-4 rounded-lg border p-6 pb-20 shadow-lg">
        <div className="flex flex-col gap-2 text-left">
          <h2 className="text-lg leading-none font-semibold">Post preview</h2>
          <p className="text-muted-foreground text-sm">Published</p>
        </div>
        <button
          type="button"
          className="text-muted-foreground absolute top-4 right-4 rounded-sm opacity-70"
          aria-label="Close"
        >
          <XIcon className="size-4" />
        </button>
        <SocialPostPreview
          account={{
            handle: "sokosumi",
            displayName: "Sokosumi",
            avatarUrl: null,
          }}
          provider="x"
          text="Launch day is here. The marketplace is live."
          media={[]}
          timestamp={new Date("2026-08-01T10:00:00Z")}
        />
        <div className="relative flex flex-row justify-end gap-2">
          {showDuplicate ? <ActionsMenu open /> : null}
          <Button
            type="button"
            variant="outline"
            className="min-h-11 md:min-h-10"
          >
            View post
            <ExternalLink className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

function FailedRow({ showDuplicate }: { showDuplicate: boolean }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div className="bg-card-background flex w-full items-center gap-1 self-start overflow-x-auto rounded-lg p-1">
        <span className="text-muted-foreground rounded-md px-3 py-1.5 text-sm font-medium">
          Calendar
        </span>
        <span className="text-muted-foreground rounded-md px-3 py-1.5 text-sm font-medium">
          Drafts
        </span>
        <span className="bg-background text-foreground rounded-md px-3 py-1.5 text-sm font-medium shadow-sm">
          Needs attention 1
        </span>
      </div>
      <ul className="space-y-2">
        <li className="bg-background border-border flex flex-wrap items-start gap-3 rounded-lg border p-3">
          <span
            aria-hidden
            className="bg-background flex size-9 shrink-0 items-center justify-center rounded-md border"
          >
            <SocialPostProviderIcon className="size-5" provider="x" />
          </span>
          <div className="min-w-48 flex-1 space-y-1.5">
            <p className="text-muted-foreground flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <SocialPostStatusBadge label="Failed" status="FAILED" />
              <time className="text-foreground font-medium whitespace-nowrap tabular-nums">
                Sep 10, 10:00 AM UTC
              </time>
              <span>@sokosumi</span>
            </p>
            <p className="text-sm whitespace-pre-wrap break-words">
              Failed text
            </p>
            <p className="text-destructive text-xs">
              X rejected the post (403 forbidden)
            </p>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Preview"
            >
              <Eye className="size-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 md:h-8"
            >
              <RotateCcw className="size-4" aria-hidden />
              Retry
            </Button>
            {showDuplicate ? <ActionsMenu open /> : null}
          </div>
        </li>
      </ul>
    </div>
  );
}

const cases: Record<string, React.ReactNode> = {
  "before-preview": <PreviewCase showDuplicate={false} />,
  "after-preview": <PreviewCase showDuplicate />,
  "before-failed": <FailedRow showDuplicate={false} />,
  "after-failed": <FailedRow showDuplicate />,
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
