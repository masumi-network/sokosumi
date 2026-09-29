import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((href: string) => {
    throw new Error(`REDIRECT:${href}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

async function visit(
  projectId: string,
  searchParams: Record<string, string | string[] | undefined> = {},
) {
  const { default: LegacyProjectSocialPage } = await import("./page");
  await expect(
    LegacyProjectSocialPage({
      params: Promise.resolve({ projectId }),
      searchParams: Promise.resolve(searchParams),
    }),
  ).rejects.toThrow(/^REDIRECT:/);
  return redirectMock.mock.calls.at(-1)?.[0] as string;
}

/**
 * Social moved out of the project page. Anyone holding the old link — a
 * bookmark, a message, a notification — has to land on the same posts, not on
 * a 404.
 */
describe("the old /projects/:id/social link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the reader to Social scoped to that project", async () => {
    expect(await visit("project-1")).toBe("/social?projectId=project-1");
  });

  it("keeps a link to one post pointing at that post", async () => {
    expect(await visit("project-1", { postId: "post-7" })).toBe(
      "/social?projectId=project-1&postId=post-7",
    );
  });

  it("never lets a stale projectId param outrank the path's project", async () => {
    // The path is the authority here: the old route's project is in it.
    expect(await visit("project-1", { projectId: "project-other" })).toBe(
      "/social?projectId=project-1",
    );
  });

  it("escapes an id that needs it", async () => {
    expect(await visit("a b&c")).toBe("/social?projectId=a+b%26c");
  });

  it("carries a repeated param through as a repeated param", async () => {
    expect(await visit("project-1", { tag: ["a", "b"] })).toBe(
      "/social?projectId=project-1&tag=a&tag=b",
    );
  });
});
