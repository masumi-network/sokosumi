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

  it("uses the generic card for networks without a native layout", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="tiktok"
        text="Clip"
        timestamp={null}
      />,
    );

    expect(screen.getByTestId("social-post-preview")).toHaveAttribute(
      "data-provider",
      "tiktok",
    );
    expect(screen.getByText("Clip")).toBeVisible();
  });
});
