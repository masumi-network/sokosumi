import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";

/** Live week-chip pieces at a 7rem Social week column. */
function WeekChip({ keepStatus }: { keepStatus: boolean }) {
  return (
    <div className="bg-muted inline-block p-6">
      <p className="text-muted-foreground mb-3 text-xs">Week</p>
      <div className="w-28">
        <span className="bg-background text-foreground border-border @container flex w-full max-w-full min-w-0 items-center gap-1 overflow-hidden rounded border px-1 py-1 text-left text-xs font-medium">
          <span
            className={
              keepStatus
                ? "flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden"
                : "flex min-w-0 flex-1 flex-col gap-0.5"
            }
          >
            <span
              className={
                keepStatus
                  ? "flex min-w-0 flex-nowrap items-center gap-0.5"
                  : "flex flex-nowrap items-center gap-0.5"
              }
            >
              <SocialPostProviderIcon
                provider="x"
                aria-hidden
                className="size-3 shrink-0"
              />
              <span
                className={
                  keepStatus
                    ? "text-muted-foreground min-w-0 truncate tabular-nums"
                    : "text-muted-foreground shrink-0 tabular-nums"
                }
              >
                12:00 PM
              </span>
              <span className="shrink-0">
                <SocialPostStatusBadge
                  className="size-4"
                  label="Failed"
                  showLabel={false}
                  status="FAILED"
                />
              </span>
            </span>
            <span className="w-full min-w-0 truncate">X post with image</span>
          </span>
          <span className="bg-muted-foreground size-7 shrink-0 rounded-md" />
        </span>
      </div>
    </div>
  );
}

const variant = process.argv[2] === "after" ? "after" : "before";
process.stdout.write(
  renderToStaticMarkup(<WeekChip keepStatus={variant === "after"} />),
);
