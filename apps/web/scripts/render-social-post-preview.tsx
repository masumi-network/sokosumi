import type { SocialPost } from "@sokosumi/core-client";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostPreview } from "@/app/projects/components/social-posts/social-post-preview";
import type { SocialPostPreviewContentProps } from "@/app/projects/components/social-posts/social-post-preview-parts";
import en from "../messages/en.json";

const IMAGE = {
  pathname: "drive/launch.png",
  fileUrl:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='800'%3E%3Crect fill='%231d4ed8' width='800' height='800'/%3E%3C/svg%3E",
  name: "launch.png",
  size: 12,
  mimeType: "image/png",
  kind: "image" as const,
};

const ACCOUNT = {
  handle: "sokosumi",
  displayName: "Sokosumi",
  avatarUrl: null,
};

const SLIDE = (color: string, name: string, pathname: string) => ({
  ...IMAGE,
  pathname,
  name,
  fileUrl: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='800'%3E%3Crect fill='${color}' width='800' height='800'/%3E%3C/svg%3E`,
});

const CASES: Record<
  string,
  SocialPostPreviewContentProps & { provider: SocialPost["provider"] }
> = {
  facebook: {
    provider: "facebook",
    account: ACCOUNT,
    text: "Launch day is here. #sokosumi https://www.example.com/launch",
    media: [IMAGE],
    timestamp: new Date("2026-10-08T10:00:00Z"),
  },
  "instagram-carousel": {
    provider: "instagram",
    account: ACCOUNT,
    text: "Launch day. #sokosumi",
    media: [
      SLIDE("%231d4ed8", "one.png", "drive/one.png"),
      SLIDE("%239f1239", "two.png", "drive/two.png"),
      SLIDE("%23047857", "three.png", "drive/three.png"),
    ],
    timestamp: new Date("2026-10-08T10:00:00Z"),
  },
};

const name = process.argv[2] ?? "facebook";
const spec = CASES[name];
if (!spec) {
  throw new Error(`Unknown preview case: ${name}`);
}

const { provider, ...content } = spec;
process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <SocialPostPreview provider={provider} {...content} />
    </NextIntlClientProvider>,
  ),
);
