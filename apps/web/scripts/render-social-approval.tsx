import { Check, MoreHorizontal } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { Button } from "@/components/ui/button";
import { UserProfileAvatar } from "@/components/user/user-profile-avatar";
import en from "../messages/en.json";

function ListRow({ approve }: { approve: boolean }) {
  return (
    <ul className="space-y-3">
      <li className="bg-background border-border flex flex-wrap items-start gap-3 rounded-lg border p-3">
        <span
          aria-hidden
          className="bg-background flex size-9 shrink-0 items-center justify-center rounded-md border"
        >
          <SocialPostProviderIcon provider="x" className="size-5" />
        </span>
        <div className="min-w-48 flex-1 space-y-1.5">
          <p className="text-muted-foreground flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <time className="text-foreground font-medium whitespace-nowrap tabular-nums">
              Oct 2, 10:00 AM UTC
            </time>
            <span className="min-w-0 truncate">@sokosumi</span>
            <SocialPostStatusBadge
              className="order-first"
              label="Needs approval"
              status="NEEDS_APPROVAL"
            />
          </p>
          <p className="text-sm whitespace-pre-wrap break-words">
            Launch recap for the waitlist.
          </p>
          <p className="text-muted-foreground text-xs">Soko Bot</p>
        </div>
        {approve ? (
          <div className="ms-auto flex items-center gap-2">
            <Button type="button" variant="outline" size="sm">
              <Check className="size-4" aria-hidden />
              Approve
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Post actions"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </div>
        ) : null}
      </li>
    </ul>
  );
}

function CalendarCard({ named }: { named: boolean }) {
  return (
    <div className="bg-background text-foreground border-border flex w-full min-w-0 flex-col items-stretch gap-1 overflow-hidden rounded-md border p-1.5 text-left text-xs font-medium">
      <span className="flex w-full min-w-0 items-center gap-1">
        <span className="flex size-4 shrink-0 items-center justify-center">
          <SocialPostProviderIcon provider="x" className="size-3" />
        </span>
        <span className="min-w-0 flex-1 truncate">@sokosumi</span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          10:00 AM
        </span>
      </span>
      <span className="text-muted-foreground w-full min-w-0 truncate font-normal">
        Launch
      </span>
      <span className="line-clamp-2 w-full min-w-0 break-words font-normal">
        Launch recap for the waitlist.
      </span>
      <span className="flex w-full min-w-0 items-center gap-1">
        <SocialPostStatusBadge
          status="NEEDS_APPROVAL"
          label="Needs approval"
          showLabel={named}
        />
        <span className="flex shrink-0">
          <UserProfileAvatar name="Soko Bot" image={null} />
        </span>
      </span>
    </div>
  );
}

function Frame({ after }: { after: boolean }) {
  return (
    <div
      className="border-border bg-background w-full max-w-xl space-y-6 rounded-xl border p-4"
      data-testid="social-approval-frame"
    >
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Needs attention</h2>
        {after ? (
          <ListRow approve />
        ) : (
          <p className="text-muted-foreground text-sm">
            No posts need attention.
          </p>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Calendar</h2>
        <div className="w-72">
          <CalendarCard named={after} />
        </div>
      </section>
    </div>
  );
}

const after = process.argv[2] !== "before";

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <Frame after={after} />
    </NextIntlClientProvider>,
  ),
);
