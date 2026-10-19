import type { SocialPostMediaRef } from "@sokosumi/core-client";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostMediaThumb } from "@/app/projects/components/social-posts/social-post-media-thumb";
import en from "../messages/en.json";

const VIDEO: SocialPostMediaRef = {
  pathname: "drive/clip.mp4",
  fileUrl: "clip.mp4",
  name: "clip.mp4",
  size: 48_000,
  mimeType: "video/mp4",
  kind: "video",
};

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <article className="bg-background text-foreground flex items-start gap-3 rounded-lg border p-3">
        <SocialPostMediaThumb media={VIDEO} />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">Draft</p>
          <p className="text-sm">Launch day clip</p>
        </div>
      </article>
    </NextIntlClientProvider>,
  ),
);
