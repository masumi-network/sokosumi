import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    useTranslations: () =>
      createTranslator({
        locale: "en",
        messages: en.App.Projects.SocialPosts.statistics,
      }),
  };
});

const copy = en.App.Projects.SocialPosts.statistics.research;
const postId = "11111111-1111-4111-8111-111111111111";

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
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        contacts: [
          {
            id: "u-1",
            name: "Ada",
            username: "ada",
            followersCount: 1200,
          },
        ],
        posts: [
          {
            author: { id: "u-2", name: "Bob", username: "bob" },
            post: { id: "p-1", text: "Mentioning launch" },
          },
        ],
        nextCursor: "next-page",
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
    expect(screen.getAllByTestId("social-post-provider-icon")).toHaveLength(2);
    const url = new URL(fetchMock.mock.calls[0][0], "https://web.test");
    expect(url.pathname).toBe(
      "/api/projects/project-1/social-statistics/account-1/audience",
    );
    expect(url.searchParams.get("kind")).toBe("mentions");
    fireEvent.click(screen.getByRole("button", { name: copy.loadMore }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      new URL(fetchMock.mock.calls[1][0], "https://web.test").searchParams.get(
        "cursor",
      ),
    ).toBe("next-page");
  });

  it("keeps likers Load disabled until a cached post is chosen", async () => {
    renderResearch();
    fireEvent.click(screen.getByLabelText(copy.kind));
    fireEvent.click(
      await screen.findByRole("option", { name: copy.kinds.likers }),
    );
    expect(screen.getByRole("button", { name: copy.load })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(copy.post));
    fireEvent.click(
      await screen.findByRole("option", { name: "Published outside Sokosumi" }),
    );
    expect(screen.getByRole("button", { name: copy.load })).toBeEnabled();
  });

  it("loads a public compare sample and a topic discovery page", async () => {
    fetchMock.mockImplementation(async (input: string) => {
      const url = new URL(input, "https://web.test");
      if (url.pathname.endsWith("/benchmark")) {
        return {
          ok: true,
          json: async () => ({
            profile: {
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
            posts: [{ id: "b-1", text: "Public launch post" }],
            coverage: "Latest public posts",
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          posts: [
            {
              author: { name: "Cara", username: "cara" },
              post: { id: "d-1", text: "Topic match" },
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
    expect(screen.getByText(copy.impressions)).toBeVisible();
    await user.click(screen.getByRole("tab", { name: copy.discover }));
    await user.type(screen.getByLabelText(copy.topic), "launch");
    await user.click(screen.getByRole("button", { name: copy.load }));
    expect(await screen.findByText("Topic match")).toBeVisible();
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
    await user.click(screen.getByRole("tab", { name: copy.discover }));
    expect(screen.getByRole("button", { name: copy.load })).toBeDisabled();
  });
});
