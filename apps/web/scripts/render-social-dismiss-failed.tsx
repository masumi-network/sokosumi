import { AlertTriangle, Eye, MoreHorizontal, RotateCcw } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import en from "../messages/en.json";

const caseName = process.argv[2] ?? "after-dialog";

function IconButton({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
      type="button"
    >
      {children}
    </button>
  );
}

function ActionsMenu({ showDismiss }: { showDismiss: boolean }) {
  return (
    <div className="relative">
      <IconButton label="Post actions">
        <MoreHorizontal className="size-4" aria-hidden />
      </IconButton>
      <div
        className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-1 min-w-40 rounded-md border p-1 shadow-md"
        role="menu"
      >
        <div className="relative flex min-h-11 cursor-default items-center rounded-sm px-2 py-1.5 text-sm">
          Reschedule
        </div>
        {showDismiss ? (
          <div className="text-destructive relative flex min-h-11 cursor-default items-center rounded-sm px-2 py-1.5 text-sm">
            Dismiss
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FailedRow({ showDismiss }: { showDismiss: boolean }) {
  return (
    <div className="shot mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div className="bg-card-background flex h-auto min-h-11 w-full min-w-0 max-w-full flex-1 items-center justify-start gap-1 overflow-x-auto rounded-lg p-1">
        <span className="text-muted-foreground rounded-md px-3 py-1.5 text-sm font-medium">
          Calendar
        </span>
        <span className="text-muted-foreground rounded-md px-3 py-1.5 text-sm font-medium">
          Drafts
        </span>
        <span className="bg-background text-foreground inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm">
          <AlertTriangle className="text-semantic-warning size-4" aria-hidden />
          Needs attention{" "}
          <span className="text-muted-foreground tabular-nums">1</span>
        </span>
      </div>
      <ul className="grid gap-2">
        <li className="bg-background border-border flex flex-wrap items-start gap-3 rounded-lg border p-3">
          <span
            aria-hidden
            className="bg-background flex size-9 shrink-0 items-center justify-center rounded-md border"
          >
            <SocialPostProviderIcon className="size-5" provider="x" />
          </span>
          <div className="min-w-48 flex-1 space-y-1.5">
            <p className="text-muted-foreground flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <time className="text-foreground font-medium whitespace-nowrap tabular-nums">
                Sep 10, 10:00 AM UTC
              </time>
              <span>@sokosumi</span>
              <SocialPostStatusBadge
                className="order-first"
                label="Failed"
                status="FAILED"
              />
            </p>
            <p className="text-sm whitespace-pre-wrap break-words">
              Launch day is here.
            </p>
            <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span>User · Alice</span>
              <span>3 attempts</span>
            </p>
            <div className="space-y-0.5 text-xs">
              <p className="text-destructive">
                The platform rejected this post.
              </p>
              <time className="text-muted-foreground">
                Failed Sep 10, 10:05 AM
              </time>
            </div>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <IconButton label="Preview">
              <Eye className="size-4" aria-hidden />
            </IconButton>
            <button
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "h-11 md:h-8",
              )}
              type="button"
            >
              <RotateCcw className="size-4" aria-hidden />
              Retry
            </button>
            <ActionsMenu showDismiss={showDismiss} />
          </div>
        </li>
      </ul>
    </div>
  );
}

function DismissDialog() {
  return (
    <div className="bg-overlay fixed inset-0 z-50 backdrop-blur-lg">
      <div
        className="bg-background fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg sm:max-w-lg"
        role="alertdialog"
      >
        <div className="flex flex-col gap-2 text-center sm:text-left">
          <h2 className="text-lg font-semibold">Dismiss this post?</h2>
          <p className="text-muted-foreground text-sm">
            It leaves Needs attention.
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className={cn(buttonVariants({ variant: "outline" }))}
            type="button"
          >
            Close
          </button>
          <button className={cn(buttonVariants())} type="button">
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

const cases: Record<string, React.ReactNode> = {
  "before-failed": <FailedRow showDismiss={false} />,
  "after-failed": <FailedRow showDismiss />,
  "after-dialog": (
    <>
      <FailedRow showDismiss />
      <DismissDialog />
    </>
  ),
};

const spec = cases[caseName];
if (!spec) {
  throw new Error(`Unknown case: ${caseName}`);
}

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      {spec}
    </NextIntlClientProvider>,
  ),
);
