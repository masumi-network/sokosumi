import type { SocialAccountPost } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "@/../messages/en.json";
import { createFormats } from "@/i18n/time-format";
import { SocialPublishedPost } from "./social-published-post";

const ACCOUNT = {
  displayName: "Launch account",
  externalHandle: "launch",
  avatarUrl: null,
};
const POST: SocialAccountPost = {
  id: "post-1",
  connectionId: "connection-1",
  provider: "x",
  externalId: "outside-123",
  publishedAt: new Date("2026-10-01T00:15:00Z"),
  text: "Published outside Sokosumi",
  contentType: "text",
  postKind: "post",
  media: [],
  url: "https://x.com/launch/status/123",
  metrics: {
    views: 0,
    impressions: null,
    likes: 5,
    comments: null,
    shares: 1,
    saves: null,
  },
  additionalMetrics: [
    { key: "quote_count", value: 0, period: "lifetime", unit: "count" },
  ],
  fetchedAt: new Date("2026-10-08T08:00:00Z"),
};
const EMPTY_METRICS = {
  views: null,
  impressions: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
};

function renderPost(
  overrides: Partial<SocialAccountPost> = {},
  account: typeof ACCOUNT | null = ACCOUNT,
  actions?: React.ReactNode,
) {
  return render(
    <NextIntlClientProvider
      formats={createFormats("h12")}
      locale="en"
      messages={en}
      now={new Date("2026-10-14T08:00:00Z")}
      timeZone="America/Los_Angeles"
    >
      <ul>
        <SocialPublishedPost
          post={{ ...POST, ...overrides }}
          account={account}
          actions={actions}
        />
      </ul>
    </NextIntlClientProvider>,
  );
}

describe("SocialPublishedPost", () => {
  it.each([
    "x",
    "linkedin",
    "instagram",
    "facebook",
    "youtube",
    "tiktok",
  ] as const)(
    "renders the real compact %s preview alongside metrics",
    (provider) => {
      renderPost({ provider });
      const card = screen.getByRole("listitem");
      const preview = within(card).getByTestId("social-post-preview");
      expect(preview).toHaveAttribute("data-provider", provider);
      expect(preview).toHaveAttribute("data-compact", "true");
      expect(within(card).getByText("Views").closest("div")).toHaveTextContent(
        "0",
      );
      expect(
        within(card).getByText("Likes / reactions").closest("div"),
      ).toHaveTextContent("5");
    },
  );

  it("uses the connected account's author name, handle and avatar initials", () => {
    renderPost();
    const preview = screen.getByTestId("social-post-preview");
    expect(within(preview).getByText("Launch account")).toBeVisible();
    expect(within(preview).getByText(/@launch/)).toBeVisible();
    expect(within(preview).getByText("LA")).toBeVisible();
  });

  it.each(["x", "linkedin", "instagram", "facebook"] as const)(
    "shows imported photos inside the compact %s preview and keeps the shared metrics grid",
    (provider) => {
      renderPost({
        provider,
        contentType: "image",
        media: [
          {
            kind: "image",
            url: "https://media.example.com/photo.jpg",
            thumbnailUrl: null,
          },
        ],
      });
      const card = screen.getByRole("listitem");
      const preview = within(card).getByTestId("social-post-preview");
      expect(preview).toHaveAttribute("data-compact", "true");
      expect(
        within(preview).getByRole("img", { name: "image" }),
      ).toHaveAttribute("src", "https://media.example.com/photo.jpg");
      expect(
        within(preview).queryByText(
          en.App.Projects.SocialPosts.preview.mediaUnavailable,
        ),
      ).not.toBeInTheDocument();
      expect(within(card).getByText("Views").closest("div")).toHaveTextContent(
        "0",
      );
      expect(within(card).getByText("Quotes").closest("dl")).toBe(
        within(card).getByText("Views").closest("dl"),
      );
      expect(within(card).queryByText("Impressions")).not.toBeInTheDocument();
      expect(within(card).getAllByText(/^Updated /)).toHaveLength(1);
    },
  );

  it.each([
    "x",
    "linkedin",
    "instagram",
    "facebook",
    "youtube",
    "tiktok",
  ] as const)(
    "shows an imported video thumbnail inside the %s preview",
    (provider) => {
      renderPost({
        provider,
        contentType: "video",
        media: [
          {
            kind: "video",
            url: "https://media.example.com/clip.mp4",
            thumbnailUrl: "https://media.example.com/thumbnail.jpg",
          },
        ],
      });
      const preview = screen.getByTestId("social-post-preview");
      expect(
        within(preview).getByRole("img", { name: "video" }),
      ).toHaveAttribute("src", "https://media.example.com/thumbnail.jpg");
      expect(preview.querySelector("video")).toBeNull();
      expect(
        within(preview).queryByText(
          en.App.Projects.SocialPosts.preview.mediaUnavailable,
        ),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps imported carousel photos in the existing preview grid", () => {
    renderPost({
      provider: "facebook",
      contentType: "carousel",
      media: ["one", "two", "three"].map((name) => ({
        kind: "image",
        url: `https://media.example.com/${name}.jpg`,
        thumbnailUrl: null,
      })),
    });
    const grid = screen.getByTestId("social-post-preview-media-grid");
    expect(within(grid).getAllByRole("img")).toHaveLength(3);
    expect(screen.getByTestId("social-post-preview")).toContainElement(grid);
  });

  it("keeps the empty-metrics message beside imported media when nothing was measured", () => {
    renderPost({
      metrics: EMPTY_METRICS,
      additionalMetrics: [],
      media: [
        {
          kind: "image",
          url: "https://media.example.com/photo.jpg",
          thumbnailUrl: null,
        },
      ],
    });
    expect(
      within(screen.getByTestId("social-post-preview")).getByRole("img", {
        name: "image",
      }),
    ).toBeVisible();
    expect(screen.getByRole("listitem").querySelector("dl")).toBeNull();
    expect(
      screen.getByText(en.App.Projects.SocialPosts.statistics.noPostMetrics),
    ).toBeVisible();
  });

  it("falls back to Your account when the connected account is unknown", () => {
    renderPost({}, null);
    expect(
      within(screen.getByTestId("social-post-preview")).getByText(
        "Your account",
      ),
    ).toBeVisible();
    expect(screen.getByText("Likes / reactions")).toBeVisible();
  });

  it("keeps media-less X posts free of missing-media placeholders", () => {
    renderPost();
    expect(
      screen.queryByText(en.App.Projects.SocialPosts.preview.mediaUnavailable),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/needs an image|needs a video/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("social-post-preview").querySelector("img, video"),
    ).toBeNull();
  });

  it.each(["instagram", "youtube", "tiktok"] as const)(
    "explains that imported %s media is unavailable",
    (provider) => {
      renderPost({ provider });
      expect(
        screen.getByText(en.App.Projects.SocialPosts.preview.mediaUnavailable),
      ).toBeVisible();
      expect(
        screen.queryByText(/needs an image|needs a video/),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("social-post-preview").querySelector("img, video"),
      ).toBeNull();
    },
  );

  it.each([
    ["x", en.App.Projects.SocialPosts.preview.x.more],
    ["linkedin", en.App.Projects.SocialPosts.preview.linkedin.seeMore],
  ] as const)(
    "folds long %s text and expands it inside the card",
    async (provider, more) => {
      const text = `${"A longer published post. ".repeat(30)}Final sentence.`;
      renderPost({ provider, text });
      const preview = screen.getByTestId("social-post-preview");
      expect(preview).not.toHaveTextContent("Final sentence.");
      await userEvent
        .setup()
        .click(within(preview).getByRole("button", { name: more }));
      expect(preview).toHaveTextContent(text);
      expect(
        within(preview).queryByRole("button", { name: more }),
      ).not.toBeInTheDocument();
      expect(screen.getAllByTestId("social-post-preview")).toHaveLength(1);
      expect(screen.getByText("Likes / reactions")).toBeVisible();
    },
  );

  it("renders a reply through the X preview with its mention styled and metrics intact", () => {
    renderPost({ text: "@someone thanks!" });
    const preview = screen.getByTestId("social-post-preview");
    expect(within(preview).getByText("@someone")).toHaveClass(
      "text-social-x-link",
    );
    expect(preview).toHaveTextContent("@someone thanks!");
    expect(
      screen.getByText("Likes / reactions").closest("div"),
    ).toHaveTextContent("5");
  });

  it("shows the exact UTC publication date with its full zone in a tooltip even for a viewer in another zone", async () => {
    renderPost();
    const time = screen.getByRole("listitem").querySelector("time");
    expect(time).toHaveTextContent("Oct 1, 12:15 AM UTC");
    expect(time).toHaveAttribute("dateTime", "2026-10-01T00:15:00.000Z");
    await userEvent.setup().hover(screen.getByRole("button", { name: "UTC" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Coordinated Universal Time",
    );
  });

  it.each([
    "x",
    "linkedin",
    "instagram",
    "facebook",
    "youtube",
    "tiktok",
  ] as const)(
    "never claims an undated published %s post was published now",
    (provider) => {
      renderPost({ provider, publishedAt: null });
      expect(screen.getByRole("listitem")).toHaveTextContent(
        en.App.Projects.SocialPosts.statistics.dateUnavailable,
      );
      if (provider !== "tiktok") {
        expect(screen.getByTestId("social-post-preview")).toHaveTextContent(
          en.App.Projects.SocialPosts.statistics.dateUnavailable,
        );
      }
      expect(screen.queryByText(/\bnow\b/i)).not.toBeInTheDocument();
      expect(screen.getByRole("listitem").querySelector("time")).toBeNull();
    },
  );

  it("labels Quotes, keeps zero and places a single muted update after all metrics", () => {
    renderPost();
    const quotes = screen.getByText("Quotes");
    expect(quotes.closest("div")).toHaveTextContent("0");
    expect(screen.queryByText(/quote count|Lifetime/i)).not.toBeInTheDocument();
    const updated = screen.getByText("Updated 6 days ago");
    expect(screen.getAllByText(/^Updated /)).toHaveLength(1);
    expect(updated).toHaveClass("text-muted-foreground", "text-xs");
    expect(
      quotes.compareDocumentPosition(updated) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      updated.compareDocumentPosition(screen.getByRole("link")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps five key metrics and the extra Quotes tile in one definition list", () => {
    const { container } = renderPost({
      metrics: { ...POST.metrics, impressions: 120, comments: 2 },
    });
    const grids = container.querySelectorAll("dl");
    expect(grids).toHaveLength(1);
    const grid = grids[0];
    expect(grid.children).toHaveLength(6);
    for (const label of [
      "Views",
      "Impressions",
      "Likes / reactions",
      "Comments",
      "Shares",
      "Quotes",
    ]) {
      expect(screen.getByText(label).closest("dl")).toBe(grid);
    }
    for (const tile of grid.children) {
      expect(tile.tagName).toBe("DIV");
      expect(tile.firstElementChild?.tagName).toBe("DT");
      expect(tile.lastElementChild?.tagName).toBe("DD");
    }
    expect(grid).not.toHaveTextContent("Updated");
  });

  it.each([
    { additionalMetrics: [] },
    {
      additionalMetrics: [
        { key: "quote_count", value: null, period: "lifetime", unit: "count" },
      ],
    },
  ])(
    "shows a short empty-metrics line when no numbers have been reported (%j)",
    ({ additionalMetrics }) => {
      renderPost({ metrics: EMPTY_METRICS, additionalMetrics });
      expect(
        screen.getByText(en.App.Projects.SocialPosts.statistics.noPostMetrics),
      ).toBeVisible();
      expect(screen.getByRole("listitem").querySelector("dl")).toBeNull();
      expect(screen.getByText("Updated 6 days ago")).toBeVisible();
    },
  );

  it("keeps an extra measured zero when all key metrics are missing", () => {
    renderPost({ metrics: EMPTY_METRICS });
    expect(screen.getByText("Quotes").closest("div")).toHaveTextContent("0");
    const grids = screen.getByRole("listitem").querySelectorAll("dl");
    expect(grids).toHaveLength(1);
    expect(grids[0].children).toHaveLength(1);
    expect(screen.getByText("Quotes").closest("dl")).toBe(grids[0]);
    expect(
      screen.queryByText(en.App.Projects.SocialPosts.statistics.noPostMetrics),
    ).not.toBeInTheDocument();
  });

  it("shows the Strong badge beside the UTC date above the metrics", () => {
    renderPost({ strong: true });
    const date = screen.getByText("Oct 1, 12:15 AM");
    expect(date).toHaveTextContent("Oct 1, 12:15 AM UTC");
    const badge = screen.getByText("Strong");
    expect(badge).toHaveAttribute("data-slot", "badge");
    expect(date.parentElement).toContainElement(badge);
    expect(
      badge.compareDocumentPosition(screen.getByText("Views")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("omits the Strong badge for a post that is not strong", () => {
    renderPost({ strong: false });
    expect(screen.queryByText("Strong")).not.toBeInTheDocument();
  });

  it.each([POST.url, null])(
    "renders supplied actions alongside the platform link when its URL is %s",
    (url) => {
      renderPost({ url }, ACCOUNT, <button type="button">Recycle</button>);
      const action = screen.getByRole("button", { name: "Recycle" });
      expect(action).toBeVisible();
      if (url) {
        expect(action.parentElement).toContainElement(
          screen.getByRole("link", {
            name: en.App.Projects.SocialPosts.statistics.openPost,
          }),
        );
      } else {
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
      }
    },
  );

  it("links to the unchanged platform URL with safe attributes and a phone tap target", () => {
    renderPost();
    const link = screen.getByRole("link", {
      name: en.App.Projects.SocialPosts.statistics.openPost,
    });
    expect(link).toHaveAttribute("href", POST.url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
    expect(link).toHaveClass("min-h-11");
    expect(link.querySelector("svg")).toBeInTheDocument();
  });

  it("omits the platform link when no URL was imported", () => {
    renderPost({ url: null });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
