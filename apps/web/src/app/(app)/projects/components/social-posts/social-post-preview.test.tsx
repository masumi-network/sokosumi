import type { SocialPostMediaRef } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SocialPostPreview } from "./social-post-preview";

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  return {
    useFormatter: () => createTestFormatter(),
    useTranslations: () => (key: string) => key,
  };
});

const ACCOUNT = {
  handle: "sokosumi",
  displayName: "Sokosumi HQ",
  avatarUrl: null,
};

const IMAGE: SocialPostMediaRef = {
  pathname: "drive/a.png",
  fileUrl: "https://store.public.blob.vercel-storage.com/drive/a.png",
  name: "a.png",
  size: 10,
  mimeType: "image/png",
  kind: "image",
};

const VIDEO: SocialPostMediaRef = {
  pathname: "drive/a.mp4",
  fileUrl: "https://store.public.blob.vercel-storage.com/drive/a.mp4",
  name: "a.mp4",
  size: 20,
  mimeType: "video/mp4",
  kind: "video",
};

describe("SocialPostPreview", () => {
  it("renders an X post with name, handle, and highlighted tags and links", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="x"
        text="Launch day #sokosumi https://www.example.com/a/very/long/path/here"
        timestamp={null}
      />,
    );

    const preview = screen.getByTestId("social-post-preview");
    expect(within(preview).getByText("Sokosumi HQ")).toBeVisible();
    expect(within(preview).getByText("@sokosumi · now")).toBeVisible();
    expect(within(preview).getByText("#sokosumi")).toHaveClass(
      "text-social-x-link",
    );
    expect(
      within(preview).getByText("example.com/a/very/long/…"),
    ).toBeVisible();
  });

  it("keeps a wrapping closing bracket out of a shortened URL", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="x"
        text="See [https://www.example.com/launch]"
        timestamp={null}
      />,
    );

    const link = screen.getByText("example.com/launch");
    expect(link).toHaveClass("text-social-x-link");
    expect(screen.getByTestId("social-post-preview")).toHaveTextContent(
      "example.com/launch]",
    );
  });

  it("keeps a wrapping angle bracket out of a shortened URL", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="x"
        text="See <https://www.example.com/launch>"
        timestamp={null}
      />,
    );

    const link = screen.getByText("example.com/launch");
    expect(link).toHaveClass("text-social-x-link");
    expect(screen.getByTestId("social-post-preview")).toHaveTextContent(
      "example.com/launch>",
    );
  });

  it("keeps trailing punctuation out of a shortened URL", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="x"
        text="See https://www.example.com/launch."
        timestamp={null}
      />,
    );

    const link = screen.getByText("example.com/launch");
    expect(link).toHaveClass("text-social-x-link");
    expect(screen.getByTestId("social-post-preview")).toHaveTextContent(
      "example.com/launch.",
    );
  });

  it("highlights an uppercase HTTPS address and leaves the period as text", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="x"
        text="See HTTPS://WWW.example.com/launch."
        timestamp={null}
      />,
    );

    expect(screen.getByText("example.com/launch")).toHaveClass(
      "text-social-x-link",
    );
    expect(screen.getByTestId("social-post-preview")).toHaveTextContent(
      "See example.com/launch.",
    );
  });

  it("keeps wrapping quotes out of a shortened URL", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="x"
        text={
          "See \"https://www.example.com/launch\" or 'www.example.com/press'"
        }
        timestamp={null}
      />,
    );

    const httpsLink = screen.getByText("example.com/launch");
    const wwwLink = screen.getByText("example.com/press");
    expect(httpsLink).toHaveClass("text-social-x-link");
    expect(wwwLink).toHaveClass("text-social-x-link");
    expect(httpsLink).toHaveTextContent("example.com/launch");
    expect(httpsLink).not.toHaveTextContent('"');
    expect(wwwLink).not.toHaveTextContent("'");
    expect(screen.getByTestId("social-post-preview")).toHaveTextContent(
      "See \"example.com/launch\" or 'example.com/press'",
    );
  });

  it("highlights a www address and leaves the period as text", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="x"
        text="See www.example.com/launch."
        timestamp={null}
      />,
    );

    expect(screen.getByText("example.com/launch")).toHaveClass(
      "text-social-x-link",
    );
    expect(screen.getByTestId("social-post-preview")).toHaveTextContent(
      "See example.com/launch.",
    );
  });

  it("highlights an X cashtag and leaves a dollar amount as text", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="x"
        text="Buy $AAPL or save $20"
        timestamp={null}
      />,
    );

    expect(screen.getByText("$AAPL")).toHaveClass("text-social-x-link");
    expect(screen.queryByText("$20")).not.toBeInTheDocument();
    expect(screen.getByTestId("social-post-preview")).toHaveTextContent(
      "Buy $AAPL or save $20",
    );
  });

  it.each(["$BRK.B", "$BRK.A", "$BRK_B"])(
    "highlights the complete X cashtag %s",
    (cashtag) => {
      render(
        <SocialPostPreview
          account={ACCOUNT}
          media={[]}
          provider="x"
          text={`Watching ${cashtag} today`}
          timestamp={null}
        />,
      );

      expect(screen.getByText(cashtag)).toHaveClass("text-social-x-link");
    },
  );

  it("does not highlight a partial X cashtag before digits", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="x"
        text="Watching $AAPL20 today"
        timestamp={null}
      />,
    );

    expect(screen.queryByText("$AAPL")).not.toBeInTheDocument();
    expect(screen.getByTestId("social-post-preview")).toHaveTextContent(
      "Watching $AAPL20 today",
    );
  });

  it("does not highlight a cashtag on LinkedIn", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="linkedin"
        text="Buy $AAPL today"
        timestamp={null}
      />,
    );

    expect(screen.queryByText("$AAPL")).not.toBeInTheDocument();
    expect(screen.getByTestId("social-post-preview")).toHaveTextContent(
      "Buy $AAPL today",
    );
  });

  it("does not treat an email address as a mention", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="x"
        text="Write hello@example.com or @alice"
        timestamp={null}
      />,
    );

    expect(screen.getByText("@alice")).toHaveClass("text-social-x-link");
    expect(screen.queryByText("@example.com")).not.toBeInTheDocument();
    expect(screen.getByTestId("social-post-preview")).toHaveTextContent(
      "hello@example.com",
    );
  });

  it("keeps a trailing period out of a mention", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="x"
        text="Ping @alice. Next"
        timestamp={null}
      />,
    );

    const mention = screen.getByText("@alice");
    expect(mention).toHaveClass("text-social-x-link");
    expect(screen.getByTestId("social-post-preview")).toHaveTextContent(
      "Ping @alice. Next",
    );
    expect(mention).not.toHaveTextContent(".");
  });

  it("shows a recent X time as relative", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="x"
        text="Launch day"
        timestamp={new Date(Date.now() - 3 * 60 * 60 * 1000)}
      />,
    );

    expect(screen.getByText("@sokosumi · 3 hours ago")).toBeVisible();
  });

  it("shows a scheduled X time as relative", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="x"
        text="Launch day"
        timestamp={new Date(Date.now() + 3 * 60 * 60 * 1000)}
      />,
    );

    expect(screen.getByText("@sokosumi · in 3 hours")).toBeVisible();
  });

  it("keeps an older X time as a short date", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="x"
        text="Launch day"
        timestamp={new Date("2026-09-01T12:00:00.000Z")}
      />,
    );

    expect(screen.getByText("@sokosumi · Sep 1")).toBeVisible();
  });

  it("keeps the X handle and time when the display name is long", () => {
    render(
      <SocialPostPreview
        account={{
          ...ACCOUNT,
          displayName: "Sokosumi Headquarters International",
        }}
        media={[]}
        provider="x"
        text="Launch day"
        timestamp={null}
      />,
    );

    expect(
      screen.getByText("Sokosumi Headquarters International"),
    ).toBeVisible();
    expect(screen.getByText("@sokosumi · now")).toBeVisible();
  });

  it("falls back to initials and the handle when the profile is missing", () => {
    render(
      <SocialPostPreview
        account={{ handle: "sokosumi", displayName: null, avatarUrl: null }}
        media={[]}
        provider="linkedin"
        text="Hello"
        timestamp={null}
      />,
    );

    expect(screen.getByText("sokosumi")).toBeVisible();
    expect(screen.getByText("SO")).toBeInTheDocument();
  });

  it("folds long LinkedIn text behind see more", async () => {
    const user = userEvent.setup();
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="linkedin"
        text={"word ".repeat(80)}
        timestamp={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "linkedin.seeMore" }));

    expect(
      screen.queryByRole("button", { name: "linkedin.seeMore" }),
    ).not.toBeInTheDocument();
  });

  it("folds LinkedIn text on a word", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="linkedin"
        text={`${"hello ".repeat(34)}UNIQWORD and more text after the fold`}
        timestamp={null}
      />,
    );

    expect(screen.getByTestId("social-post-preview")).not.toHaveTextContent(
      "UNIQWORD",
    );
    expect(
      screen.getByRole("button", { name: "linkedin.seeMore" }),
    ).toBeVisible();
  });

  it("highlights Instagram tags and links in the Instagram link color", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="instagram"
        text="Launch #sokosumi @alice https://example.com/a"
        timestamp={null}
      />,
    );

    expect(screen.getByText("#sokosumi")).toHaveClass(
      "text-social-instagram-link",
    );
    expect(screen.getByText("@alice")).toHaveClass(
      "text-social-instagram-link",
    );
    expect(screen.getByText("example.com/a")).toHaveClass(
      "text-social-instagram-link",
    );
  });

  it("shows Instagram's date in uppercase dense type", () => {
    const { rerender } = render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="instagram"
        text="Caption"
        timestamp={new Date("2026-10-10T12:00:00.000Z")}
      />,
    );
    expect(screen.getByText("October 10")).toHaveClass("text-2xs", "uppercase");

    rerender(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="instagram"
        text="Caption"
        timestamp={null}
      />,
    );
    expect(screen.getByText("now")).toHaveClass("text-2xs", "uppercase");
  });

  it("shows Instagram's 4:5 media frame and asks for media when missing", () => {
    const { rerender } = render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="instagram"
        text="Caption"
        timestamp={null}
      />,
    );
    const frame = screen.getByTestId("social-post-preview-instagram-frame");
    expect(frame).toHaveClass("aspect-[4/5]", "bg-media-ground");
    expect(screen.getByText("instagram.mediaRequired")).toHaveClass(
      "text-on-media-muted",
    );

    rerender(
      <SocialPostPreview
        account={ACCOUNT}
        media={[IMAGE]}
        provider="instagram"
        text="Caption"
        timestamp={null}
      />,
    );
    expect(screen.getByRole("img", { name: "a.png" })).toBeVisible();
    expect(
      screen.getByTestId("social-post-preview-instagram-frame"),
    ).toHaveClass("aspect-[4/5]", "bg-media-ground");
    expect(screen.queryByLabelText("instagram.slide")).not.toBeInTheDocument();
  });

  it("marks extra Instagram slides on the first frame", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[
          IMAGE,
          { ...IMAGE, pathname: "drive/b.png", name: "b.png" },
          { ...IMAGE, pathname: "drive/c.png", name: "c.png" },
        ]}
        provider="instagram"
        text="Caption"
        timestamp={null}
      />,
    );
    expect(screen.getByLabelText("instagram.slide")).toHaveTextContent(
      "instagram.slideIndex",
    );
    expect(screen.getByRole("img", { name: "a.png" })).toBeVisible();
    expect(
      screen.queryByRole("img", { name: "b.png" }),
    ).not.toBeInTheDocument();
  });

  it("marks a GIF with a GIF badge", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[
          {
            ...IMAGE,
            pathname: "drive/a.gif",
            name: "a.gif",
            mimeType: "image/gif",
            kind: "gif",
          },
        ]}
        provider="x"
        text=""
        timestamp={null}
      />,
    );

    expect(screen.getByTestId("social-post-preview-gif")).toHaveTextContent(
      "GIF",
    );
  });

  it("lays out several images in a grid", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[IMAGE, { ...IMAGE, pathname: "drive/b.png", name: "b.png" }]}
        provider="x"
        text=""
        timestamp={null}
      />,
    );

    expect(
      within(screen.getByTestId("social-post-preview-media-grid")).getAllByRole(
        "img",
      ),
    ).toHaveLength(2);
  });

  it("renders a Facebook feed card with public reach, tags, and actions", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="facebook"
        text="Launch day #sokosumi https://www.example.com/launch"
        timestamp={null}
      />,
    );

    const preview = screen.getByTestId("social-post-preview");
    expect(preview).toHaveAttribute("data-provider", "facebook");
    expect(within(preview).getByText("Sokosumi HQ")).toBeVisible();
    expect(within(preview).getByLabelText("facebook.public")).toBeVisible();
    expect(within(preview).getByText("#sokosumi")).toHaveClass(
      "text-social-facebook-link",
    );
    expect(within(preview).getByText("example.com/launch")).toBeVisible();
    expect(preview).toHaveTextContent("facebook.like");
    expect(preview).toHaveTextContent("facebook.comment");
    expect(preview).toHaveTextContent("facebook.share");
  });

  it("enlarges a short Facebook status with no media", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="facebook"
        text="Launch day is here."
        timestamp={null}
      />,
    );

    expect(screen.getByText("Launch day is here.").closest("p")).toHaveClass(
      "text-3xl",
    );
  });

  it("keeps usual type on a short Facebook post with a photo", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[IMAGE]}
        provider="facebook"
        text="Launch day is here."
        timestamp={null}
      />,
    );

    expect(
      screen.getByText("Launch day is here.").closest("p"),
    ).not.toHaveClass("text-3xl");
  });

  it("folds long Facebook text behind see more", async () => {
    const user = userEvent.setup();
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="facebook"
        text={"word ".repeat(120)}
        timestamp={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "facebook.seeMore" }));

    expect(
      screen.queryByRole("button", { name: "facebook.seeMore" }),
    ).not.toBeInTheDocument();
  });

  it("renders a YouTube watch card with title, tags, and a play overlay", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[VIDEO]}
        provider="youtube"
        text={`${"T".repeat(120)}\nFirst clip #sokosumi https://www.example.com/watch`}
        timestamp={null}
      />,
    );

    const preview = screen.getByTestId("social-post-preview");
    expect(preview).toHaveAttribute("data-provider", "youtube");
    expect(within(preview).getByText("T".repeat(100))).toBeVisible();
    expect(within(preview).getByText("Sokosumi HQ")).toBeVisible();
    expect(within(preview).getByText("#sokosumi")).toHaveClass(
      "text-social-youtube-link",
    );
    expect(within(preview).getByText("example.com/watch")).toBeVisible();
    expect(preview.querySelector("video")).toHaveAttribute(
      "src",
      VIDEO.fileUrl,
    );
  });

  it("keeps leftover title text in the YouTube description", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[VIDEO]}
        provider="youtube"
        text={"T".repeat(120)}
        timestamp={null}
      />,
    );

    const preview = screen.getByTestId("social-post-preview");
    expect(within(preview).getByText("T".repeat(100))).toBeVisible();
    expect(within(preview).getByText("T".repeat(20))).toBeVisible();
  });

  it("uses the first non-empty line as the YouTube title", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[VIDEO]}
        provider="youtube"
        text={"\n  Launch today  \nmore text"}
        timestamp={null}
      />,
    );

    const preview = screen.getByTestId("social-post-preview");
    expect(within(preview).getByText("Launch today")).toBeVisible();
    expect(within(preview).getByText("more text")).toBeVisible();
  });

  it("asks for a video when YouTube has no media", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="youtube"
        text="Launch day"
        timestamp={null}
      />,
    );

    expect(
      screen.getByTestId("social-post-preview-youtube-player"),
    ).toHaveClass("aspect-video", "bg-media-ground");
    expect(screen.getByText("youtube.videoRequired")).toHaveClass(
      "text-on-media-muted",
    );
  });

  it("folds long YouTube description behind show more", async () => {
    const user = userEvent.setup();
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[VIDEO]}
        provider="youtube"
        text={`Title\n${"word ".repeat(80)}`}
        timestamp={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "youtube.seeMore" }));

    expect(
      screen.queryByRole("button", { name: "youtube.seeMore" }),
    ).not.toBeInTheDocument();
  });

  it("marks a video with a play badge on Instagram and X", () => {
    const { rerender } = render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[VIDEO]}
        provider="instagram"
        text="Clip"
        timestamp={null}
      />,
    );
    expect(screen.getByTestId("social-post-preview-play")).toBeVisible();
    expect(screen.getByLabelText("a.mp4")).toHaveAttribute(
      "src",
      VIDEO.fileUrl,
    );

    rerender(
      <SocialPostPreview
        account={ACCOUNT}
        media={[VIDEO]}
        provider="x"
        text=""
        timestamp={null}
      />,
    );
    expect(screen.getByTestId("social-post-preview-play")).toBeVisible();
  });

  it("renders a TikTok clip with handle, tags, and a 9:16 frame", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[VIDEO]}
        provider="tiktok"
        text="Launch day #sokosumi https://www.example.com/clip"
        timestamp={null}
      />,
    );

    const preview = screen.getByTestId("social-post-preview");
    expect(preview).toHaveAttribute("data-provider", "tiktok");
    expect(within(preview).getByText("@sokosumi")).toBeVisible();
    expect(within(preview).getByText("#sokosumi")).toHaveClass("font-semibold");
    expect(within(preview).getByText("example.com/clip")).toBeVisible();
    expect(preview.querySelector("video")).toHaveAttribute(
      "src",
      VIDEO.fileUrl,
    );
  });

  it("asks for a video when TikTok has no media", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="tiktok"
        text="Clip"
        timestamp={null}
      />,
    );

    expect(screen.getByTestId("social-post-preview-tiktok-frame")).toHaveClass(
      "aspect-[9/16]",
      "bg-media-ground",
    );
    expect(screen.getByText("tiktok.videoRequired")).toHaveClass(
      "text-on-media-muted",
    );
    expect(screen.getByText("@sokosumi")).toBeVisible();
    expect(screen.getByText("Clip")).toBeVisible();
  });

  it("uses the display name when TikTok has no handle", () => {
    render(
      <SocialPostPreview
        account={{ handle: null, displayName: "Sokosumi HQ", avatarUrl: null }}
        media={[]}
        provider="tiktok"
        text="Launch day"
        timestamp={null}
      />,
    );

    expect(screen.getByText("Sokosumi HQ")).toBeVisible();
    expect(screen.queryByText("@Sokosumi HQ")).not.toBeInTheDocument();
    expect(screen.getByText("Launch day")).toBeVisible();
  });

  it("folds long TikTok caption behind more", async () => {
    const user = userEvent.setup();
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[VIDEO]}
        provider="tiktok"
        text={"word ".repeat(40)}
        timestamp={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "tiktok.more" }));

    expect(
      screen.queryByRole("button", { name: "tiktok.more" }),
    ).not.toBeInTheDocument();
  });

  it("caps a single image on a compact card", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        compact
        media={[IMAGE]}
        provider="linkedin"
        text="Hello"
        timestamp={null}
      />,
    );

    const frame = screen.getByTestId("social-post-preview-media-compact");
    expect(frame).toHaveClass("max-h-64");
    expect(screen.getByRole("img", { name: "a.png" })).toHaveClass(
      "max-h-64",
      "object-top",
    );
    expect(screen.getByTestId("social-post-preview")).toHaveAttribute(
      "data-compact",
      "true",
    );
  });

  it("keeps feed-height media when the card is not compact", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[IMAGE]}
        provider="linkedin"
        text="Hello"
        timestamp={null}
      />,
    );

    expect(
      screen.queryByTestId("social-post-preview-media-compact"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "a.png" })).toHaveClass(
      "max-h-[32rem]",
    );
  });

  it("folds long X text on a compact card and calls onSeeMore", async () => {
    const user = userEvent.setup();
    const onSeeMore = vi.fn();
    render(
      <SocialPostPreview
        account={ACCOUNT}
        compact
        media={[]}
        onSeeMore={onSeeMore}
        provider="x"
        text={"word ".repeat(80)}
        timestamp={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "x.more" }));
    expect(onSeeMore).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "x.more" })).toBeVisible();
  });

  it("opens the full preview from LinkedIn see more when onSeeMore is set", async () => {
    const user = userEvent.setup();
    const onSeeMore = vi.fn();
    render(
      <SocialPostPreview
        account={ACCOUNT}
        compact
        media={[]}
        onSeeMore={onSeeMore}
        provider="linkedin"
        text={"word ".repeat(80)}
        timestamp={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "linkedin.seeMore" }));
    expect(onSeeMore).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "linkedin.seeMore" }),
    ).toBeVisible();
  });
});
