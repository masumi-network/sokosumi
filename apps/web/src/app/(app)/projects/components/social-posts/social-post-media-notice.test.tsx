import type { SocialPostMediaRef } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import german from "@/messages/de.json";
import english from "@/messages/en.json";
import spanish from "@/messages/es.json";
import { SocialPostPreview } from "./social-post-preview";

const TOOL_NOTICE = "English tool fact that the preview must not display.";
const IMAGE: SocialPostMediaRef = {
  pathname: "drive/padded.jpg",
  fileUrl: "https://example.com/padded.jpg",
  name: "Tall image",
  size: 100,
  mimeType: "image/jpeg",
  kind: "image",
  transformation: {
    provider: "instagram",
    code: "pad_4_5",
    notice: TOOL_NOTICE,
    original: {
      pathname: "drive/original.jpg",
      fileUrl: "https://example.com/original.jpg",
      name: "Tall image",
      size: 100,
      mimeType: "image/jpeg",
      kind: "image",
    },
  },
};

describe("Social post media notices", () => {
  it.each([
    {
      locale: "en",
      messages: english,
      notice: "Instagram will pad this image to 4:5.",
    },
    {
      locale: "de",
      messages: german,
      notice: "Instagram fügt Ränder für 4:5 hinzu.",
    },
    {
      locale: "es",
      messages: spanish,
      notice: "Instagram añadirá márgenes para 4:5.",
    },
  ])(
    "shows one localized notice in $locale",
    ({ locale, messages, notice }) => {
      render(
        <NextIntlClientProvider
          locale={locale}
          messages={messages}
          timeZone="UTC"
        >
          <SocialPostPreview
            account={{
              displayName: "Masumi",
              handle: "masumi",
              avatarUrl: null,
            }}
            media={[IMAGE, { ...IMAGE, pathname: "drive/second.jpg" }]}
            provider="instagram"
            text="Launch post"
            timestamp={null}
          />
        </NextIntlClientProvider>,
      );

      expect(screen.getAllByText(notice)).toHaveLength(1);
      expect(screen.getByTestId("social-post-media-notice")).toBeVisible();
      expect(screen.queryByText(TOOL_NOTICE)).not.toBeInTheDocument();
    },
  );
});
