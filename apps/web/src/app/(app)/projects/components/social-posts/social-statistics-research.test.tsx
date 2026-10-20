import type {
  SocialPerformanceContact,
  SocialStatisticsResearchPost,
} from "@sokosumi/core-client";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/../messages/en.json";
import { TestQueryProvider } from "@/test/query-provider";
import { SocialStatisticsResearch } from "./social-statistics-research";

const fetchMock = vi.fn();
vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const { createTranslator } =
    await vi.importActual<typeof import("next-intl")>("next-intl");
  return {
    useFormatter: () => createTestFormatter({ timeZone: "UTC" }),
    useTranslations: (
      namespace:
        | "App.Projects.SocialPosts.statistics"
        | "App.Projects.SocialPosts.preview",
    ) =>
      createTranslator({
        locale: "en",
        messages: en,
        namespace,
      }),
  };
});

const copy = en.App.Projects.SocialPosts.statistics.research;
const postId = "11111111-1111-4111-8111-111111111111";
const contact: SocialPerformanceContact = {
  id: "u-1",
  name: "Ada",
  username: "ada",
  avatarUrl: "https://images.test/ada.jpg",
  description: null,
  location: null,
  followersCount: 1200,
  interactions: 7,
  replies: 2,
  quotes: 1,
  mentions: 3,
  likes: 0,
  reposts: null,
};

function samplePost(
  overrides: Partial<SocialStatisticsResearchPost> = {},
): SocialStatisticsResearchPost {
  return {
    id: postId,
    connectionId: "account-1",
    provider: "x",
    externalId: "123",
    text: "Mentioning launch",
    url: "https://x.com/bob/status/123",
    publishedAt: new Date("2020-10-01T12:00:00Z"),
    fetchedAt: new Date("2020-10-02T12:00:00Z"),
    metrics: {
      views: 0,
      impressions: 40,
      likes: 5,
      comments: 2,
      shares: 1,
      saves: null,
    },
    additionalMetrics: [],
    media: [],
    ...overrides,
  };
}

function samplePosts(count: number, prefix = "Post") {
  return Array.from({ length: count }, (_, index) =>
    samplePost({ id: `${prefix}-${index}`, text: `${prefix} ${index + 1}` }),
  );
}

function renderResearch() {
  return render(
    <TestQueryProvider>
      <SocialStatisticsResearch
        projectId="project-1"
        accountId="account-1"
        posts={[{ id: postId, text: "Published outside Sokosumi" }]}
      />
    </TestQueryProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("SocialStatisticsResearch", () => {
  it("does not fetch until Load and then reads mentions from the selected account", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          contacts: [contact],
          posts: [
            {
              author: { ...contact, id: "u-2", name: "Bob", username: "bob" },
              post: samplePost({
                media: [
                  {
                    kind: "image",
                    url: "https://pbs.twimg.com/media/launch.jpg?format=jpg&name=small",
                    thumbnailUrl: null,
                  },
                  {
                    kind: "video",
                    url: "https://video.twimg.com/launch.mp4",
                    thumbnailUrl:
                      "https://pbs.twimg.com/ext_tw_video_thumb/launch.jpg",
                  },
                ],
              }),
            },
          ],
          nextCursor: "next-page",
          coverage: "Latest 20 mentions",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          contacts: [],
          posts: [
            {
              author: null,
              post: samplePost({
                id: "post-2",
                text: "Another mention",
                url: null,
                externalId: "456",
              }),
            },
          ],
          nextCursor: null,
          coverage: "Latest 20 mentions",
        }),
      });
    renderResearch();
    expect(screen.getByRole("heading", { name: copy.title })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: copy.load }));
    expect(await screen.findByText("Ada")).toBeVisible();
    expect(screen.getByText("Mentioning launch")).toBeVisible();
    expect(screen.getByText("Latest 20 mentions")).toBeVisible();
    const preview = screen.getByTestId("social-post-preview");
    expect(preview).toHaveAttribute("data-provider", "x");
    expect(preview).toHaveAttribute("data-compact", "true");
    expect(preview).toHaveTextContent("Bob");
    expect(preview).toHaveTextContent("@bob · Oct 1");
    const images = within(preview).getAllByRole("img", {
      name: copy.postImage,
    });
    expect(images[0]).toBeVisible();
    expect(images[0]).toHaveAttribute(
      "src",
      "https://pbs.twimg.com/media/launch.jpg?format=jpg&name=small",
    );
    expect(images[1]).toBeVisible();
    expect(images[1]).toHaveAttribute(
      "src",
      "https://pbs.twimg.com/ext_tw_video_thumb/launch.jpg",
    );
    expect(preview.querySelector("video")).toBeNull();
    const card = preview.closest("li");
    expect(card).not.toBeNull();
    if (!card) throw new Error("Missing preview card");
    expect(card).toHaveClass("flex", "h-full", "min-w-0", "flex-col", "gap-2");
    expect(card).not.toHaveClass("border");
    expect(card).not.toHaveClass("p-4");
    expect(preview.parentElement).toBe(card);
    expect(card.parentElement).toHaveClass(
      "grid",
      "gap-4",
      "sm:grid-cols-2",
      "xl:grid-cols-3",
    );
    expect(
      within(card).getByText("Views").nextElementSibling,
    ).toHaveTextContent("0");
    expect(
      within(card).getByText(
        en.App.Projects.SocialPosts.statistics.metrics.likes,
      ).nextElementSibling,
    ).toHaveTextContent("5");
    expect(
      within(card).getByRole("link", { name: copy.openOnX }),
    ).toHaveAttribute("href", "https://x.com/bob/status/123");
    expect(preview).not.toContainElement(
      within(card).getByRole("link", { name: copy.openOnX }),
    );
    expect(screen.getByText("1,200 followers")).toBeVisible();
    expect(screen.getByText("@ada")).toBeVisible();
    expect(screen.getByText(copy.replies).nextElementSibling).toHaveTextContent(
      "2",
    );
    const url = new URL(fetchMock.mock.calls[0][0], "https://web.test");
    expect(url.pathname).toBe(
      "/api/projects/project-1/social-statistics/account-1/audience",
    );
    expect(url.searchParams.get("kind")).toBe("mentions");
    fireEvent.click(screen.getByRole("button", { name: copy.showMore }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      new URL(fetchMock.mock.calls[1][0], "https://web.test").searchParams.get(
        "cursor",
      ),
    ).toBe("next-page");
    expect(await screen.findByText("Another mention")).toBeVisible();
    expect(screen.getByText(copy.unknownAuthor)).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: copy.openOnX })[1],
    ).toHaveAttribute("href", "https://x.com/i/status/456");
    expect(
      screen.queryByRole("button", { name: copy.showMore }),
    ).not.toBeInTheDocument();
  });

  it.each([
    { tab: copy.audience, label: null },
    { tab: copy.compare, label: copy.handle },
    { tab: copy.discover, label: copy.topic },
  ])(
    "shows six $tab posts in the Drafts grid, then six more",
    async ({ tab, label }) => {
      const posts = samplePosts(100);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          profile: contact,
          summary: {
            postCount: 100,
            views: null,
            impressions: 4000,
            interactions: 800,
          },
          contacts: [],
          posts:
            tab === copy.compare
              ? posts
              : posts.map((post) => ({ author: contact, post })),
          nextCursor: null,
        }),
      });
      const user = userEvent.setup();
      renderResearch();
      await user.click(screen.getByRole("tab", { name: tab }));
      if (label) await user.type(screen.getByLabelText(label), "launch");
      await user.click(screen.getByRole("button", { name: copy.load }));
      await screen.findByText("Post 1");
      expect(screen.getAllByTestId("social-post-preview")).toHaveLength(6);
      expect(screen.queryByText("Post 7")).not.toBeInTheDocument();
      expect(screen.getByRole("list")).toHaveClass(
        "grid",
        "gap-4",
        "sm:grid-cols-2",
        "xl:grid-cols-3",
      );
      for (const item of screen.getAllByRole("listitem")) {
        expect(item).toHaveClass(
          "flex",
          "h-full",
          "min-w-0",
          "flex-col",
          "gap-2",
        );
        expect(item).not.toHaveClass("border");
        expect(item).not.toHaveClass("p-4");
      }
      const showMore = screen.getByRole("button", { name: copy.showMore });
      expect(showMore).toHaveClass("h-11", "md:h-8");
      await user.click(showMore);
      expect(screen.getAllByTestId("social-post-preview")).toHaveLength(12);
      expect(screen.getByText("Post 12")).toBeVisible();
      expect(screen.queryByText("Post 13")).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { tab: copy.audience, label: null },
    { tab: copy.discover, label: copy.topic },
  ])(
    "shows all loaded $tab posts before fetching another page",
    async ({ tab, label }) => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            contacts: [],
            posts: samplePosts(14).map((post) => ({ author: contact, post })),
            nextCursor: "next-page",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            contacts: [],
            posts: samplePosts(8, "Next post").map((post) => ({
              author: contact,
              post,
            })),
            nextCursor: null,
          }),
        });
      const user = userEvent.setup();
      renderResearch();
      await user.click(screen.getByRole("tab", { name: tab }));
      if (label) await user.type(screen.getByLabelText(label), "launch");
      await user.click(screen.getByRole("button", { name: copy.load }));
      await screen.findByText("Post 1");
      expect(screen.getAllByTestId("social-post-preview")).toHaveLength(6);
      for (const count of [12, 14]) {
        await user.click(screen.getByRole("button", { name: copy.showMore }));
        expect(screen.getAllByTestId("social-post-preview")).toHaveLength(
          count,
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
      await user.click(screen.getByRole("button", { name: copy.showMore }));
      await screen.findByText("Next post 6");
      expect(screen.getAllByTestId("social-post-preview")).toHaveLength(20);
      expect(screen.queryByText("Next post 7")).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        new URL(
          fetchMock.mock.calls[1][0],
          "https://web.test",
        ).searchParams.get("cursor"),
      ).toBe("next-page");
      await user.click(screen.getByRole("button", { name: copy.showMore }));
      expect(screen.getAllByTestId("social-post-preview")).toHaveLength(22);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByRole("button", { name: copy.showMore }),
      ).not.toBeInTheDocument();
    },
  );

  it("orders top posts by impressions, then interactions including quotes", async () => {
    const posts = (
      [
        ["Unknown impressions", null, 1000, 0],
        ["Fewer interactions", 100, 1, 0],
        ["Zero impressions", 0, 1, 0],
        ["More interactions", 100, 4, 0],
        ["Lower impressions", 50, 100, 0],
        ["Highest impressions", 200, 0, 0],
        ["More quotes", 100, 1, 4],
      ] as const
    ).map(([text, impressions, likes, quotes]) =>
      samplePost({
        id: text,
        text,
        metrics: {
          views: null,
          impressions,
          likes,
          comments: 0,
          shares: 0,
          saves: null,
        },
        additionalMetrics: [
          {
            key: "quote_count",
            value: quotes,
            period: "lifetime",
            unit: null,
          },
        ],
      }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        profile: contact,
        summary: {
          postCount: 7,
          views: null,
          impressions: 125000,
          interactions: 1111,
        },
        posts,
      }),
    });
    const user = userEvent.setup();
    renderResearch();
    await user.click(screen.getByRole("tab", { name: copy.compare }));
    await user.type(screen.getByLabelText(copy.handle), "launch");
    await user.click(screen.getByRole("button", { name: copy.load }));
    expect(
      await screen.findByRole("heading", { name: copy.topPosts }),
    ).toBeVisible();
    expect(
      screen
        .getAllByTestId("social-post-preview")
        .map(
          (preview) =>
            posts.find((post) => within(preview).queryByText(post.text))?.text,
        ),
    ).toEqual([
      "Highest impressions",
      "More quotes",
      "More interactions",
      "Fewer interactions",
      "Lower impressions",
      "Zero impressions",
    ]);
    const summary = screen.getByText(copy.posts).closest("dl");
    if (!summary) throw new Error("Missing benchmark summary");
    expect(within(summary).getAllByRole("term")).toHaveLength(4);
    for (const label of within(summary).getAllByRole("term")) {
      expect(label).toHaveClass("text-sm", "text-muted-foreground");
    }
    for (const value of within(summary).getAllByRole("definition")) {
      expect(value).toHaveClass("text-2xl", "sm:text-4xl", "tabular-nums");
    }
    expect(within(summary).getByTitle("125,000")).toHaveTextContent("125K");
    expect(within(summary).getByTitle(copy.unavailable)).toHaveTextContent("—");
    expect(within(summary).queryByRole("img")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.showMore }));
    expect(screen.getAllByTestId("social-post-preview")).toHaveLength(7);
    expect(
      screen.getAllByTestId("social-post-preview").at(-1),
    ).toHaveTextContent("Unknown impressions");
  });

  it.each(["https://x.com/bob/status/123", null])(
    "opens folded post text on X using its URL %s",
    async (url) => {
      const open = vi.fn();
      vi.stubGlobal("open", open);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          contacts: [],
          posts: [
            {
              author: contact,
              post: samplePost({ text: "Long public post. ".repeat(30), url }),
            },
          ],
          nextCursor: null,
        }),
      });
      const user = userEvent.setup();
      renderResearch();
      await user.click(screen.getByRole("button", { name: copy.load }));
      await user.click(
        await screen.findByRole("button", {
          name: en.App.Projects.SocialPosts.preview.x.more,
        }),
      );
      expect(open).toHaveBeenCalledWith(
        url ?? "https://x.com/i/status/123",
        "_blank",
        "noopener,noreferrer",
      );
    },
  );

  it.each(["likers", "reposters"] as const)(
    "requires a cached post for %s and keeps people as a compact list",
    async (kind) => {
      renderResearch();
      fireEvent.click(screen.getByLabelText(copy.kind));
      fireEvent.click(
        await screen.findByRole("option", { name: copy.kinds[kind] }),
      );
      expect(screen.getByRole("button", { name: copy.load })).toBeDisabled();
      expect(fetchMock).not.toHaveBeenCalled();
      fireEvent.click(screen.getByLabelText(copy.post));
      fireEvent.click(
        await screen.findByRole("option", {
          name: "Published outside Sokosumi",
        }),
      );
      expect(screen.getByRole("button", { name: copy.load })).toBeEnabled();
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          contacts: [contact],
          posts: [],
          nextCursor: "people-next",
        }),
      });
      fireEvent.click(screen.getByRole("button", { name: copy.load }));
      expect(await screen.findByText("@ada")).toBeVisible();
      expect(
        screen.queryByTestId("social-post-preview"),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: copy.loadMore })).toBeVisible();
      expect(
        screen.queryByRole("button", { name: copy.showMore }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Likes").nextElementSibling).toHaveTextContent(
        "0",
      );
      const url = new URL(fetchMock.mock.calls[0][0], "https://web.test");
      expect(url.searchParams.get("kind")).toBe(kind);
      expect(url.searchParams.get("postId")).toBe(postId);
    },
  );

  it.each([
    { tab: copy.audience, label: null },
    { tab: copy.compare, label: copy.handle },
    { tab: copy.discover, label: copy.topic },
  ])(
    "shows a Performance-style skeleton while $tab loads",
    async ({ tab, label }) => {
      fetchMock.mockImplementation(() => new Promise(() => {}));
      const user = userEvent.setup();
      renderResearch();
      expect(
        screen.queryByTestId("social-research-loading"),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole("tab", { name: tab }));
      if (label) await user.type(screen.getByLabelText(label), "launch");
      const load = screen.getByRole("button", { name: copy.load });
      expect(load).toHaveClass("h-11", "md:h-8");
      await user.click(load);
      expect(screen.getByTestId("social-research-loading")).toHaveAttribute(
        "aria-busy",
        "true",
      );
      expect(screen.getByTestId("social-research-loading")).toHaveTextContent(
        copy.loading,
      );
      expect(screen.queryByText(copy.empty)).not.toBeInTheDocument();
    },
  );

  it.each([
    { tab: copy.compare, label: copy.handle },
    { tab: copy.discover, label: copy.topic },
  ])(
    "retries $tab for the same input and shows the shared empty state",
    async ({ tab, label }) => {
      fetchMock.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          profile: contact,
          summary: {
            postCount: 0,
            views: null,
            impressions: null,
            interactions: null,
          },
          posts: [],
          nextCursor: null,
        }),
      });
      const user = userEvent.setup();
      renderResearch();
      await user.click(screen.getByRole("tab", { name: tab }));
      await user.type(screen.getByLabelText(label), "launch");
      await user.click(screen.getByRole("button", { name: copy.load }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        copy.loadFailed,
      );
      await user.click(screen.getByRole("button", { name: copy.load }));
      expect(await screen.findByText(copy.empty)).toBeVisible();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps discovery cards during a failed next page and retries its cursor", async () => {
    const data = {
      posts: [{ author: contact, post: samplePost() }],
      nextCursor: "next-discovery",
      coverage: "Recent public posts",
    };
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(data)))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...data,
            posts: [
              {
                author: null,
                post: samplePost({ id: "post-2", text: "Next topic match" }),
              },
            ],
            nextCursor: null,
          }),
        ),
      );
    const user = userEvent.setup();
    renderResearch();
    await user.click(screen.getByRole("tab", { name: copy.discover }));
    await user.type(screen.getByLabelText(copy.topic), " launch ");
    await user.click(screen.getByRole("button", { name: copy.load }));
    expect(await screen.findByTestId("social-post-preview")).toBeVisible();
    await user.click(screen.getByRole("button", { name: copy.showMore }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.loadFailed);
    expect(screen.getByText("Mentioning launch")).toBeVisible();
    await user.click(screen.getByRole("button", { name: copy.showMore }));
    expect(await screen.findByText("Next topic match")).toBeVisible();
    expect(screen.getAllByTestId("social-post-preview")).toHaveLength(2);
    for (const [input, options] of fetchMock.mock.calls.slice(1)) {
      const url = new URL(input, "https://web.test");
      expect(url.searchParams.get("topic")).toBe("launch");
      expect(url.searchParams.get("cursor")).toBe("next-discovery");
      expect(options.cache).toBe("no-store");
      expect(options.method).toBeUndefined();
    }
  });

  it("loads a public compare sample and a topic discovery page", async () => {
    fetchMock.mockImplementation(async (input: string) => {
      const url = new URL(input, "https://web.test");
      if (url.pathname.endsWith("/benchmark")) {
        return {
          ok: true,
          json: async () => ({
            profile: {
              ...contact,
              name: "Launch",
              username: "launch",
              followersCount: 90,
            },
            summary: {
              postCount: 2,
              views: null,
              impressions: 40,
              interactions: 6,
            },
            posts: [
              samplePost({
                id: "b-1",
                text: "Public launch post",
                url: "https://x.com/launch/status/123",
              }),
            ],
            coverage: "Latest public posts",
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          posts: [
            {
              author: { ...contact, name: "Cara", username: "cara" },
              post: samplePost({
                id: "d-1",
                text: "Topic match",
                url: "https://x.com/cara/status/123",
              }),
            },
          ],
          nextCursor: null,
          coverage: "Recent public posts",
        }),
      };
    });
    const user = userEvent.setup();
    renderResearch();
    await user.click(screen.getByRole("tab", { name: copy.compare }));
    await user.type(screen.getByLabelText(copy.handle), "launch");
    await user.click(screen.getByRole("button", { name: copy.load }));
    expect(await screen.findByText("Public launch post")).toBeVisible();
    expect(screen.getAllByText(copy.impressions)).toHaveLength(2);
    expect(screen.getByTestId("social-post-preview")).toHaveTextContent(
      "@launch · Oct 1",
    );
    expect(screen.getByRole("link", { name: copy.openOnX })).toHaveAttribute(
      "href",
      "https://x.com/launch/status/123",
    );
    await user.click(screen.getByRole("tab", { name: copy.discover }));
    await user.type(screen.getByLabelText(copy.topic), "launch");
    await user.click(screen.getByRole("button", { name: copy.load }));
    expect(await screen.findByText("Topic match")).toBeVisible();
    expect(screen.getByTestId("social-post-preview")).toHaveTextContent(
      "@cara · Oct 1",
    );
    expect(screen.getByRole("link", { name: copy.openOnX })).toHaveAttribute(
      "href",
      "https://x.com/cara/status/123",
    );
    expect(
      screen.queryByRole("button", { name: /publish|schedule|recycle|edit/i }),
    ).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.map(
        ([input]) => new URL(input, "https://web.test").pathname,
      ),
    ).toEqual([
      "/api/projects/project-1/social-statistics/account-1/benchmark",
      "/api/projects/project-1/social-statistics/account-1/discovery",
    ]);
  });

  it("shows a retryable load failure without fetching on a blank topic", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({ ok: false });
    renderResearch();
    await user.click(screen.getByRole("button", { name: copy.load }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.loadFailed);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ contacts: [], posts: [], nextCursor: null }),
    });
    await user.click(screen.getByRole("button", { name: copy.load }));
    expect(await screen.findByText(copy.empty)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("tab", { name: copy.discover }));
    expect(screen.getByRole("button", { name: copy.load })).toBeDisabled();
  });
});
