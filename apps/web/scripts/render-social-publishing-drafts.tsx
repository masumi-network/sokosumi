import { Eye } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { Button } from "@/components/ui/button";
import en from "../messages/en.json";

const includePublishing = process.argv[2] !== "before";

function Row({
  id,
  status,
  label,
  text,
  handle,
  creator,
}: {
  id: string;
  status: "DRAFT" | "PUBLISHING";
  label: string;
  text: string;
  handle: string;
  creator: string;
}) {
  return (
    <li
      className="bg-background border-border flex flex-wrap items-start gap-3 rounded-lg border p-3"
      data-testid={`social-post-${id}`}
    >
      <span
        aria-hidden
        className="bg-background flex size-9 shrink-0 items-center justify-center rounded-md border"
      >
        <SocialPostProviderIcon provider="x" className="size-5" />
      </span>
      <div className="min-w-48 flex-1 space-y-1.5">
        <p className="text-muted-foreground flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="min-w-0 truncate">{handle}</span>
          <SocialPostStatusBadge
            className="order-first"
            label={label}
            status={status}
          />
        </p>
        <p className="text-sm whitespace-pre-wrap break-words">{text}</p>
        <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>{creator}</span>
        </p>
      </div>
      <div className="ms-auto flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon" aria-label="Preview">
          <Eye className="size-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

const count = includePublishing ? 2 : 1;

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <section className="w-[36rem] space-y-3" data-testid="publishing-drafts">
        <div className="bg-muted inline-flex h-8 items-center rounded-lg p-0.5 text-sm">
          <span className="bg-background rounded-md px-3 py-1 font-medium">
            Drafts {count}
          </span>
          <span className="text-muted-foreground px-3 py-1">Performance</span>
        </div>
        <ul className="grid gap-2">
          <Row
            id="post-draft"
            status="DRAFT"
            label="Draft"
            text="Save this for later."
            handle="@sokosumi"
            creator="User · Alice"
          />
          {includePublishing ? (
            <Row
              id="post-publishing"
              status="PUBLISHING"
              label="Publishing…"
              text="Launch day is here."
              handle="@sokosumi"
              creator="User · Alice"
            />
          ) : null}
        </ul>
      </section>
    </NextIntlClientProvider>,
  ),
);
