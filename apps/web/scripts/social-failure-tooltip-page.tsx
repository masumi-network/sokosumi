/** Playwright capture page for Social failure reason tooltips. */
import { createRoot } from "react-dom/client";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { SocialPostStatusReasonTooltip } from "@/app/projects/components/social-posts/social-post-status-reason-tooltip";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { useMountEffect } from "@/hooks/use-mount-effect";

const REASON =
  "Coworker scheduling access was revoked. Reschedule this post to publish it.";

export function SocialFailureTooltipPage() {
  useMountEffect(() => {
    document.body.dataset.hydrated = "true";
  });

  return (
    <div
      className="bg-muted text-foreground min-h-screen p-4"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      <div className="mx-auto w-full max-w-xs">
        <div
          className="bg-background text-foreground border-border flex w-full min-w-0 flex-col items-stretch gap-1 overflow-hidden rounded-md border p-1.5 text-left text-xs font-medium"
          data-testid="calendar-social-post"
        >
          <span className="flex w-full min-w-0 items-center gap-1">
            <SocialPostProviderIcon
              aria-label="X · @team"
              className="size-3"
              provider="x"
              role="img"
            />
            <span className="min-w-0 flex-1 truncate">@team</span>
            <span className="text-muted-foreground shrink-0 tabular-nums">
              12:00 PM
            </span>
          </span>
          <span className="text-muted-foreground w-full min-w-0 truncate font-normal">
            Launch project
          </span>
          <span className="line-clamp-2 w-full min-w-0 break-words font-normal">
            Launch news
          </span>
          <span className="flex w-full min-w-0 items-center gap-1">
            <SocialPostStatusReasonTooltip label="Failed" reason={REASON}>
              <SocialPostStatusBadge label="Failed" status="FAILED" />
            </SocialPostStatusReasonTooltip>
          </span>
        </div>
      </div>
    </div>
  );
}

if (typeof document !== "undefined" && document.getElementById("fixture")) {
  const root = document.getElementById("fixture");
  if (root) {
    try {
      createRoot(root).render(<SocialFailureTooltipPage />);
    } catch (error) {
      document.body.dataset.moduleError = String(error);
    }
  }
}
