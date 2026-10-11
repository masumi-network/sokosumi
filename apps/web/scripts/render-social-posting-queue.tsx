import { Check, ImagePlus, MoreHorizontal, Plus, XIcon } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostPreview } from "@/app/projects/components/social-posts/social-post-preview";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import en from "../messages/en.json";

const caseName = process.argv[2] ?? "after-composer";

function AccountChip() {
  return (
    <button
      type="button"
      className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-foreground ps-1 pe-3 text-sm font-medium md:h-8"
    >
      <span className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full">
        <SocialPostProviderIcon aria-hidden className="size-3.5" provider="x" />
      </span>
      <span>@sokosumi</span>
      <Check className="size-3.5" aria-hidden />
    </button>
  );
}

function Composer({ showQueue }: { showQueue: boolean }) {
  return (
    <div className="bg-overlay fixed inset-0 grid place-items-center p-4 backdrop-blur-lg">
      <div className="bg-background flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border shadow-lg">
        <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center px-6 py-3 md:px-8">
          <div />
          <h3 className="text-base font-semibold">New post</h3>
          <div className="justify-self-end">
            <Button type="button" variant="ghost" size="sm">
              <span className="text-primary text-sm">Cancel</span>
            </Button>
          </div>
        </div>
        <div className="shrink-0 border-t" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-4 md:px-8">
          <span className="text-muted-foreground text-sm font-medium">
            Account
          </span>
          <AccountChip />
        </div>
        <div className="space-y-3 border-t px-6 py-5 md:px-8">
          <p className="text-base leading-relaxed">
            Launch day is here. The marketplace is live.
          </p>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-11 md:h-8"
            >
              <ImagePlus className="size-4" aria-hidden />
              Add from Drive
            </Button>
            <span className="text-muted-foreground ms-auto text-xs tabular-nums">
              46 / 280
            </span>
          </div>
        </div>
        <div className="grid gap-4 border-t px-6 py-5 md:grid-cols-[minmax(0,1fr)_20rem] md:px-8">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">When</h3>
            <p className="text-muted-foreground text-xs">
              Optional. Leave it empty to keep a draft.
            </p>
          </div>
          <SocialPostPreview
            account={{
              handle: "sokosumi",
              displayName: "Sokosumi",
              avatarUrl: null,
            }}
            provider="x"
            text="Launch day is here. The marketplace is live."
            media={[]}
            timestamp={null}
          />
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-3 border-t px-6 py-3 sm:flex-row sm:items-center md:px-8">
          <div className="text-muted-foreground min-w-0 flex-1 text-sm">
            Posts as @sokosumi
          </div>
          <div className="flex items-center justify-end gap-2">
            {showQueue ? (
              <Button type="button" variant="outline">
                Add to queue
              </Button>
            ) : null}
            <Button type="button" variant="ghost">
              Save draft
            </Button>
            <Button type="button" className="min-w-28">
              Post now
              <kbd
                aria-hidden
                className="hidden font-sans text-xs opacity-70 sm:inline"
              >
                ⌘↵
              </kbd>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountRow() {
  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <span
        aria-hidden
        className="bg-background flex size-9 shrink-0 items-center justify-center rounded-md border"
      >
        <SocialPostProviderIcon className="size-5" provider="x" />
      </span>
      <div className="min-w-40 flex-1">
        <p className="truncate text-sm font-medium">@sokosumi</p>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
          <span>X account</span>
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className="bg-semantic-success size-1.5 rounded-full"
            />
            Connected
          </span>
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Account actions"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </Button>
    </li>
  );
}

function Accounts({ showQueue }: { showQueue: boolean }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 md:p-6">
      <div className="bg-card-background flex w-full items-center gap-1 self-start overflow-x-auto rounded-lg p-1">
        <span className="text-muted-foreground rounded-md px-3 py-1.5 text-sm font-medium">
          Calendar
        </span>
        <span className="text-muted-foreground rounded-md px-3 py-1.5 text-sm font-medium">
          Drafts
        </span>
        <span className="bg-background text-foreground rounded-md px-3 py-1.5 text-sm font-medium shadow-sm">
          Accounts
        </span>
      </div>
      <section className="flex flex-col gap-4" aria-label="Accounts">
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 shrink-0 md:h-8"
          >
            <Plus className="size-4" aria-hidden />
            Connect account
          </Button>
        </div>
        <ul className="divide-y rounded-lg border">
          <AccountRow />
        </ul>
      </section>
      {showQueue ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Posting queue</h3>
              <p className="text-muted-foreground text-sm">
                Named weekly times. Add to queue uses the next free one.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 shrink-0 md:h-8"
            >
              <Plus className="size-4" aria-hidden />
              Add time
            </Button>
          </div>
          <div className="grid max-w-md gap-2">
            <Label htmlFor="social-queue-timezone">Time zone</Label>
            <div
              id="social-queue-timezone"
              className="border-input bg-background flex h-11 items-center rounded-md border px-3 text-sm md:h-8"
            >
              Europe/Zurich
            </div>
          </div>
          <ul className="divide-y rounded-lg border">
            <li className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_8rem_7rem_auto] md:items-end">
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input readOnly value="Tuesday morning" />
              </div>
              <div className="grid gap-1.5">
                <Label>Day</Label>
                <div className="border-input bg-background flex h-11 items-center rounded-md border px-3 text-sm md:h-8">
                  Tuesday
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Time</Label>
                <Input readOnly type="time" value="11:00" />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 md:h-8"
                aria-label="Remove Tuesday morning"
              >
                <XIcon className="size-4" aria-hidden />
              </Button>
            </li>
            <li className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_8rem_7rem_auto] md:items-end">
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input readOnly value="Wednesday 09:00" />
              </div>
              <div className="grid gap-1.5">
                <Label>Day</Label>
                <div className="border-input bg-background flex h-11 items-center rounded-md border px-3 text-sm md:h-8">
                  Wednesday
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Time</Label>
                <Input readOnly type="time" value="09:00" />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 md:h-8"
                aria-label="Remove Wednesday 09:00"
              >
                <XIcon className="size-4" aria-hidden />
              </Button>
            </li>
          </ul>
          <div>
            <Button type="button" size="sm" className="h-11 md:h-8">
              Save queue
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

const cases: Record<string, React.ReactNode> = {
  "before-composer": <Composer showQueue={false} />,
  "after-composer": <Composer showQueue />,
  "before-accounts": <Accounts showQueue={false} />,
  "after-accounts": <Accounts showQueue />,
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
