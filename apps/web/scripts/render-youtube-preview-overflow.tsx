import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostPreview } from "@/app/projects/components/social-posts/social-post-preview";
import en from "../messages/en.json";

const ACCOUNT = {
  handle: "sokosumi",
  displayName: "Sokosumi HQ",
  avatarUrl: null,
};

const CLIP = {
  pathname: "drive/launch.png",
  fileUrl:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1280' height='720'%3E%3Crect fill='%231d4ed8' width='1280' height='720'/%3E%3C/svg%3E",
  name: "launch.png",
  size: 12,
  mimeType: "image/png",
  kind: "image" as const,
};

/** One line, longer than YouTube's 100-character title. */
const CAPTION =
  "Launch day recap: the livestream, the guest list, and everything we shipped this week on social now. Watch the full recap.";

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <SocialPostPreview
        account={ACCOUNT}
        media={[CLIP]}
        provider="youtube"
        text={CAPTION}
        timestamp={null}
      />
    </NextIntlClientProvider>,
  ),
);
