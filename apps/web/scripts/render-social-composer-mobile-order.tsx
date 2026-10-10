import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostPreview } from "@/app/projects/components/social-posts/social-post-preview";
import { createFormats } from "@/i18n/time-format";
import en from "../messages/en.json";

const variant = process.argv[2] ?? "after";
const editorOrder = variant === "before" ? "order-2" : "order-1";
const previewOrder = variant === "before" ? "order-1" : "order-2";
const whenOrder = variant === "before" ? "order-2" : "order-3";

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider
      formats={createFormats("h12")}
      locale="en"
      messages={en}
      timeZone="UTC"
    >
      <div className="bg-background w-full max-w-sm overflow-hidden rounded-lg border shadow-lg">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">New post</h2>
        </div>
        <div className="grid auto-rows-min grid-cols-1">
          <div className="order-first flex items-center gap-2 px-6 py-4">
            <span className="text-muted-foreground text-sm font-medium">
              Post to
            </span>
            <span className="inline-flex h-8 items-center rounded-full border px-3 text-sm">
              @sokosumi
            </span>
          </div>
          <div className={`${editorOrder} space-y-3 border-t px-6 py-5`}>
            <p className="text-base leading-relaxed">
              Launch day is here. The clip is ready.
            </p>
            <p className="text-muted-foreground text-xs tabular-nums">
              38 / 280
            </p>
          </div>
          <section className={`${whenOrder} space-y-2 border-t px-6 py-5`}>
            <h3 className="text-sm font-semibold">When</h3>
            <p className="text-muted-foreground text-xs">Your time: UTC</p>
          </section>
          <aside
            className={`bg-background-muted ${previewOrder} flex flex-col gap-3 border-t px-6 py-5`}
          >
            <p className="text-muted-foreground text-xs font-medium">Preview</p>
            <SocialPostPreview
              account={{
                handle: "sokosumi",
                displayName: "Sokosumi",
                avatarUrl: null,
              }}
              media={[]}
              provider="x"
              text="Launch day is here. The clip is ready."
              timestamp={new Date("2026-09-10T10:00:00.000Z")}
            />
          </aside>
        </div>
      </div>
    </NextIntlClientProvider>,
  ),
);
