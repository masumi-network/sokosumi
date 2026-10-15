import { MoreHorizontal } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { Button } from "@/components/ui/button";

function MenuItem({ children }: { children: string }) {
  return (
    <div className="relative flex min-h-11 cursor-default items-center rounded-sm px-2 py-1.5 text-sm">
      {children}
    </div>
  );
}

/** Drafts row plus its open actions menu, using the live badge and logo. */
function DraftPublishMenu({ showPublishNow }: { showPublishNow: boolean }) {
  return (
    <div className="bg-muted w-[32rem] p-6 pb-40">
      <div className="relative">
        <article className="bg-background border-border flex flex-wrap items-start gap-3 rounded-lg border p-3">
          <span
            aria-hidden
            className="bg-background flex size-9 shrink-0 items-center justify-center rounded-md border"
          >
            <SocialPostProviderIcon provider="tiktok" className="size-5" />
          </span>
          <div className="min-w-48 flex-1 space-y-1.5">
            <p className="text-muted-foreground flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="min-w-0 truncate">@sokosumi</span>
              <SocialPostStatusBadge
                className="order-first"
                label="Draft"
                status="DRAFT"
              />
            </p>
            <p className="text-sm whitespace-pre-wrap break-words">
              Caption only
            </p>
            <p className="text-muted-foreground text-xs">User · Alice</p>
          </div>
          <div className="ms-auto">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Post actions"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </div>
        </article>
        <div className="bg-popover text-popover-foreground absolute top-[calc(100%+0.25rem)] right-3 z-50 min-w-[8rem] rounded-md border p-1 shadow-md">
          {showPublishNow ? <MenuItem>Publish now</MenuItem> : null}
          <MenuItem>Edit</MenuItem>
          <MenuItem>Schedule</MenuItem>
        </div>
      </div>
    </div>
  );
}

const variant = process.argv[2] === "after" ? "after" : "before";
process.stdout.write(
  renderToStaticMarkup(
    <DraftPublishMenu showPublishNow={variant === "before"} />,
  ),
);
