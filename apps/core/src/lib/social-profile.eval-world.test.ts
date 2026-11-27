import { describe, expect, it, vi } from "vitest";

const { ssrfSafeFetch, withBrowser } = vi.hoisted(() => ({
  ssrfSafeFetch: vi.fn(),
  withBrowser: vi.fn(),
}));
vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch,
}));
vi.mock("@/lib/site-capture", () => ({ withBrowser, readPageText: vi.fn() }));

import { runInEvalWorld } from "@/lib/evals/eval-world-context";
import { readSocialProfile } from "./social-profile";

describe("readSocialProfile in an eval lane", () => {
  it("reads the owner's fixed profiles, however the address is written", async () => {
    const read = (url: string) =>
      runInEvalWorld("ws-eval", () => readSocialProfile(url));
    await expect(read("https://twitter.com/padierfind")).resolves.toMatchObject(
      {
        readable: false,
      },
    );
    await expect(read("https://www.x.com/padierfind/")).resolves.toMatchObject({
      network: "x",
      followers: "850",
      readable: true,
      recent: [
        expect.objectContaining({ date: "2026-11-25" }),
        expect.anything(),
      ],
    });
    await expect(
      read("https://youtube.com/@padierfind"),
    ).resolves.toMatchObject({
      network: "youtube",
      readable: true,
    });
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
    expect(withBrowser).not.toHaveBeenCalled();
  });

  it("says a profile the world lacks could not be read, without fetching it", async () => {
    await expect(
      runInEvalWorld("ws-eval", () =>
        readSocialProfile("https://www.instagram.com/someone-else"),
      ),
    ).resolves.toMatchObject({ readable: false, recent: [] });
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
    expect(withBrowser).not.toHaveBeenCalled();
  });
});
