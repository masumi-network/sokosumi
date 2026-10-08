import { beforeEach, describe, expect, it, vi } from "vitest";

const startCmoOnboarding = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));

vi.mock("../lib/core", () => ({
  coreForCurrentUser: async () => ({ client: {} }),
}));

vi.mock("@sokosumi/core-client", () => ({ startCmoOnboarding }));

const { onboard } = await import("./cmo-actions");

const EMPTY = { attempt: 0, websiteUrl: "", errors: {} };

function form(websiteUrl: string) {
  const data = new FormData();
  data.set("workspaceId", "ws-1");
  data.set("websiteUrl", websiteUrl);
  data.set("goals", "More leads");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  startCmoOnboarding.mockResolvedValue({ data: {}, error: undefined });
});

describe("onboard", () => {
  it("hires Cuso with the website as the identity step stores it", async () => {
    await onboard(EMPTY, form("acme.io"));

    expect(startCmoOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          workspaceId: "ws-1",
          websiteUrl: "https://acme.io/",
          goals: "More leads",
        },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("keeps what was typed and names the website when it is not one", async () => {
    const state = await onboard(EMPTY, form("not a site"));

    expect(startCmoOnboarding).not.toHaveBeenCalled();
    expect(state).toEqual({
      attempt: 1,
      websiteUrl: "not a site",
      errors: { websiteUrl: "Enter a website, like acme.com." },
    });
  });

  it("says so when Core refuses, keeping the answers", async () => {
    startCmoOnboarding.mockResolvedValue({ error: { message: "nope" } });

    const state = await onboard(EMPTY, form("acme.io"));

    expect(state.errors).toEqual({ form: "That did not work. Try again." });
    expect(state.websiteUrl).toBe("acme.io");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
