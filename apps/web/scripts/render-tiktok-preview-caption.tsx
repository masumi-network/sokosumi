import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialPostPreview } from "@/app/projects/components/social-posts/social-post-preview";
import en from "../messages/en.json";

const ACCOUNT = {
  handle: null,
  displayName: "Sokosumi HQ",
  avatarUrl: null,
};

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="tiktok"
        text="Launch day clip. #sokosumi"
        timestamp={null}
      />
    </NextIntlClientProvider>,
  ),
);
