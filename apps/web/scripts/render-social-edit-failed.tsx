import { Eye, MoreHorizontal, RotateCcw, XIcon } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostPreview } from "@/app/projects/components/social-posts/social-post-preview";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { Button } from "@/components/ui/button";
import en from "../messages/en.json";

const caseName = process.argv[2] ?? "after-failed";

function ActionsMenu({ showEdit }: { showEdit: boolean }) {
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
      <div
        className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-1 min-w-[10rem] rounded-md border p-1 shadow-md"
        role="menu"
      >
        {showEdit ? (
          <div className="relative flex min-h-11 cursor-default items-center rounded-sm px-2 py-1.5 text-sm">
            Edit
          </div>
        ) : null}
        <div className="relative flex min-h-11 cursor-default items-center rounded-sm px-2 py-1.5 text-sm">
          Reschedule
        </div>
      </div>
    </div>
  );
}

function FailedRow({ showEdit }: { showEdit: boolean }) {
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
              Launch day is here.
            </p>
            <p className="text-destructive text-xs">
              The platform rejected this post.
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
            <ActionsMenu showEdit={showEdit} />
          </div>
        </li>
      </ul>
    </div>
  );
}

function EditComposer() {
  return (
    <div className="bg-overlay fixed inset-0 grid place-items-center p-4 backdrop-blur-lg">
      <div className="bg-background relative grid w-full max-w-3xl gap-0 overflow-hidden rounded-lg border shadow-lg">
        <div className="flex items-start justify-between gap-4 p-6 pb-0">
          <h2 className="text-lg leading-none font-semibold">Edit post</h2>
          <button
            type="button"
            className="text-muted-foreground rounded-sm opacity-70"
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="space-y-4 p-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-muted-foreground text-sm font-medium">
                Account
              </span>
              <span className="inline-flex h-8 items-center gap-2 rounded-full border border-foreground ps-1 pe-3 text-sm font-medium">
                <span className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full">
                  <SocialPostProviderIcon
                    aria-hidden
                    className="size-3.5"
                    provider="x"
                  />
                </span>
                <span>@sokosumi</span>
              </span>
            </div>
            <textarea
              aria-label="Text"
              className="placeholder:text-muted-foreground min-h-40 w-full resize-none border-0 bg-transparent px-0 text-base leading-relaxed outline-none"
              defaultValue="Launch day is here."
              readOnly
            />
          </div>
          <aside className="border-t p-6 md:border-t-0 md:border-s">
            <SocialPostPreview
              account={{
                handle: "sokosumi",
                displayName: "Sokosumi",
                avatarUrl: null,
              }}
              provider="x"
              text="Launch day is here."
              media={[]}
              timestamp={null}
            />
          </aside>
        </div>
        <div className="flex justify-end gap-2 border-t px-6 py-3">
          <Button type="button" className="min-w-28">
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

const cases: Record<string, React.ReactNode> = {
  "before-failed": <FailedRow showEdit={false} />,
  "after-failed": <FailedRow showEdit />,
  "after-composer": <EditComposer />,
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
