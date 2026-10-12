import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";

/** Drafts row using the live badge and logo. `after` names the missing video. */
function DraftNeedsMedia({ showHint }: { showHint: boolean }) {
  return (
    <div className="bg-muted w-[32rem] p-6">
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
          {showHint ? (
            <p className="text-muted-foreground text-xs" role="status">
              TikTok needs a video.
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs">User · Alice</p>
        </div>
      </article>
    </div>
  );
}

const variant = process.argv[2] === "after" ? "after" : "before";
process.stdout.write(
  renderToStaticMarkup(<DraftNeedsMedia showHint={variant === "after"} />),
);
