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

  it("folds LinkedIn text on a word and shows an ellipsis", () => {
    render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="linkedin"
        text={`${"hello ".repeat(34)}UNIQWORD and more text after the fold`}
        timestamp={null}
      />,
    );

    const preview = screen.getByTestId("social-post-preview");
    expect(preview).toHaveTextContent("…");
    expect(preview).not.toHaveTextContent("UNIQWORD");
    expect(
      screen.getByRole("button", { name: "linkedin.seeMore" }),
    ).toBeVisible();
  });

  it("shows Instagram's square media frame and asks for media when missing", () => {
    const { rerender } = render(
      <SocialPostPreview
        account={ACCOUNT}
        media={[]}
        provider="instagram"
        text="Caption"
        timestamp={null}
      />,
    );
    expect(screen.getByText("instagram.mediaRequired")).toBeVisible();

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
