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
  const { default: LegacyProjectStudioPage } = await import("./page");
  await expect(
    LegacyProjectStudioPage({
      params: Promise.resolve({ projectId }),
      searchParams: Promise.resolve(searchParams),
    }),
  ).rejects.toThrow(/^REDIRECT:/);
  return redirectMock.mock.calls.at(-1)?.[0] as string;
}

/**
 * The studio moved out of the project page. Anyone holding the old link — a
 * bookmark, a message, a tile in an older deployment — has to land on the same
 * images, not on a 404.
 */
describe("the old /projects/:id/studio link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the reader to the studio scoped to that project", async () => {
    expect(await visit("project-1")).toBe("/studio?projectId=project-1");
  });

  it("keeps a shared version or conversation pointing at the same thing", async () => {
    expect(await visit("project-1", { v: "asset-7", s: "session-3" })).toBe(
      "/studio?projectId=project-1&v=asset-7&s=session-3",
    );
  });

  it("never lets a stale projectId param outrank the path's project", async () => {
    // The path is the authority here: the old route's project is in it.
    expect(await visit("project-1", { projectId: "project-other" })).toBe(
      "/studio?projectId=project-1",
    );
  });

  it("escapes an id that needs it", async () => {
    expect(await visit("a b&c")).toBe("/studio?projectId=a+b%26c");
  });

  it("carries a repeated param through as a repeated param", async () => {
    expect(await visit("project-1", { tag: ["a", "b"] })).toBe(
      "/studio?projectId=project-1&tag=a&tag=b",
    );
  });
});
